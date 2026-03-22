import { create } from 'zustand';
import { Platform } from 'react-native';
import { File, Paths, Directory } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import type {
  ObjectCacheManifest,
  ObjectCacheSnapshot,
  RecentObjectCacheEntry,
  S3Object,
} from '@/lib/types';
import * as S3Service from '@/lib/s3-service';

const OBJECT_CACHE_DIR = 's3man_object_cache';
const OBJECT_CACHE_MANIFEST_KEY = 's3man_object_cache_manifest';
const OBJECT_CACHE_VERSION = 1 as const;
const MAX_RECENT_PREFIXES = 5;
const MAX_PREWARM_PREFIXES = 3;
const MAX_TOTAL_CACHE_BYTES = 25 * 1024 * 1024;
const MAX_SINGLE_SNAPSHOT_BYTES = 5 * 1024 * 1024;
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CacheSource = 'none' | 'memory' | 'disk';

interface CacheLoadResult {
  hit: boolean;
  cachedAt?: string;
  source: CacheSource;
}

interface ObjectState {
  currentConnectionId: string;
  currentBucket: string;
  currentPrefix: string;
  objects: S3Object[];
  selectedKeys: Set<string>;
  isLoading: boolean;
  _prefixCache: Map<string, S3Object[]>;
  setCurrentBucket: (connectionId: string, bucket: string) => void;
  setCurrentPrefix: (prefix: string) => void;
  setObjects: (objects: S3Object[], options?: { cachedAt?: string; persist?: boolean }) => void;
  hasPrefixCache: (connectionId: string, bucket: string, prefix: string) => boolean;
  loadCachedObjects: (connectionId: string) => Promise<CacheLoadResult>;
  clearBucketSnapshots: (connectionId: string, bucket: string) => Promise<void>;
  prewarmRecentObjects: (connectionIds: string[]) => Promise<void>;
  setLoading: (loading: boolean) => void;
  toggleSelection: (key: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  isSelected: (key: string) => boolean;
  breadcrumbs: () => { label: string; prefix: string }[];
}

function _getCacheDir(): Directory {
  return new Directory(Paths.document, OBJECT_CACHE_DIR);
}

function _getManifestFile(): File {
  return new File(_getCacheDir(), 'manifest.json');
}

function _buildPrefixCacheKey(connectionId: string, bucket: string, prefix: string): string {
  return `${connectionId}:${bucket}:${prefix}`;
}

function _buildSnapshotStorageKey(connectionId: string, bucket: string, prefix: string): string {
  return `obj:${connectionId}:${bucket}:${prefix}`;
}

function _cacheFileName(connectionId: string, bucket: string, prefix: string): string {
  const raw = `${connectionId}_${bucket}_${prefix}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
}

function _sameCacheEntry(
  entry: Pick<RecentObjectCacheEntry, 'connectionId' | 'bucket' | 'prefix'>,
  connectionId: string,
  bucket: string,
  prefix: string
): boolean {
  return (
    entry.connectionId === connectionId && entry.bucket === bucket && entry.prefix === prefix
  );
}

function _estimateBytes(value: string): number {
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return value.length;
  }
}

function _isExpired(timestamp: string): boolean {
  return Date.now() - new Date(timestamp).getTime() > SNAPSHOT_TTL_MS;
}

function _defaultManifest(): ObjectCacheManifest {
  return {
    version: OBJECT_CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    entries: [],
  };
}

async function _writeManifest(manifest: ObjectCacheManifest): Promise<void> {
  try {
    const json = JSON.stringify(manifest);
    if (Platform.OS === 'web') {
      localStorage.setItem(OBJECT_CACHE_MANIFEST_KEY, json);
      return;
    }

    const dir = _getCacheDir();
    if (!dir.exists) dir.create({ intermediates: true });
    _getManifestFile().write(json);
  } catch {}
}

async function _readManifest(): Promise<ObjectCacheManifest> {
  try {
    let json: string | null = null;

    if (Platform.OS === 'web') {
      json = localStorage.getItem(OBJECT_CACHE_MANIFEST_KEY);
    } else {
      const file = _getManifestFile();
      if (file.exists) {
        json = await file.text();
      }
    }

    if (!json) {
      return _defaultManifest();
    }

    const parsed = JSON.parse(json) as Partial<ObjectCacheManifest>;
    if (!Array.isArray(parsed.entries)) {
      return _defaultManifest();
    }

    return {
      version: OBJECT_CACHE_VERSION,
      updatedAt:
        typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      entries: parsed.entries.filter(Boolean) as RecentObjectCacheEntry[],
    };
  } catch {
    return _defaultManifest();
  }
}

function _getSnapshotFile(connectionId: string, bucket: string, prefix: string): File {
  return new File(_getCacheDir(), _cacheFileName(connectionId, bucket, prefix));
}

async function _deleteSnapshotStorage(
  entry: Pick<RecentObjectCacheEntry, 'connectionId' | 'bucket' | 'prefix'>
): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      localStorage.removeItem(
        _buildSnapshotStorageKey(entry.connectionId, entry.bucket, entry.prefix)
      );
      return;
    }

    const file = _getSnapshotFile(entry.connectionId, entry.bucket, entry.prefix);
    if (file.exists) {
      await FileSystemLegacy.deleteAsync(file.uri, { idempotent: true });
    }
  } catch {}
}

async function _writeSnapshot(snapshot: ObjectCacheSnapshot): Promise<number | null> {
  try {
    const json = JSON.stringify(snapshot);
    const sizeBytes = _estimateBytes(json);
    if (sizeBytes > MAX_SINGLE_SNAPSHOT_BYTES) {
      return null;
    }

    if (Platform.OS === 'web') {
      localStorage.setItem(
        _buildSnapshotStorageKey(snapshot.connectionId, snapshot.bucket, snapshot.prefix),
        json
      );
      return sizeBytes;
    }

    const dir = _getCacheDir();
    if (!dir.exists) dir.create({ intermediates: true });
    _getSnapshotFile(snapshot.connectionId, snapshot.bucket, snapshot.prefix).write(json);
    return sizeBytes;
  } catch {
    return null;
  }
}

async function _readSnapshot(
  connectionId: string,
  bucket: string,
  prefix: string
): Promise<ObjectCacheSnapshot | null> {
  try {
    let json: string | null = null;

    if (Platform.OS === 'web') {
      json = localStorage.getItem(_buildSnapshotStorageKey(connectionId, bucket, prefix));
    } else {
      const file = _getSnapshotFile(connectionId, bucket, prefix);
      if (!file.exists) return null;
      json = await file.text();
    }

    if (!json) return null;

    const parsed = JSON.parse(json) as Partial<ObjectCacheSnapshot> | S3Object[];
    if (Array.isArray(parsed)) {
      return {
        connectionId,
        bucket,
        prefix,
        cachedAt: new Date().toISOString(),
        itemCount: parsed.length,
        objects: parsed,
      };
    }

    if (!Array.isArray(parsed.objects)) {
      return null;
    }

    return {
      connectionId,
      bucket,
      prefix,
      cachedAt: typeof parsed.cachedAt === 'string' ? parsed.cachedAt : new Date().toISOString(),
      itemCount:
        typeof parsed.itemCount === 'number' ? parsed.itemCount : parsed.objects.length,
      objects: parsed.objects,
    };
  } catch {
    return null;
  }
}

async function _pruneManifest(manifest: ObjectCacheManifest): Promise<ObjectCacheManifest> {
  const uniqueEntries: RecentObjectCacheEntry[] = [];
  const seen = new Set<string>();

  for (const entry of [...manifest.entries].sort((a, b) =>
    b.lastAccessedAt.localeCompare(a.lastAccessedAt)
  )) {
    const cacheKey = _buildPrefixCacheKey(entry.connectionId, entry.bucket, entry.prefix);
    if (seen.has(cacheKey)) continue;
    seen.add(cacheKey);
    uniqueEntries.push(entry);
  }

  const keep: RecentObjectCacheEntry[] = [];
  let totalBytes = 0;

  for (const entry of uniqueEntries) {
    const isUsable = !_isExpired(entry.lastAccessedAt) && entry.sizeBytes <= MAX_SINGLE_SNAPSHOT_BYTES;
    const fitsBudget =
      keep.length < MAX_RECENT_PREFIXES && totalBytes + entry.sizeBytes <= MAX_TOTAL_CACHE_BYTES;

    if (isUsable && fitsBudget) {
      keep.push(entry);
      totalBytes += entry.sizeBytes;
    }
  }

  const keepKeys = new Set(
    keep.map((entry) => _buildPrefixCacheKey(entry.connectionId, entry.bucket, entry.prefix))
  );

  for (const entry of uniqueEntries) {
    const cacheKey = _buildPrefixCacheKey(entry.connectionId, entry.bucket, entry.prefix);
    if (!keepKeys.has(cacheKey)) {
      await _deleteSnapshotStorage(entry);
    }
  }

  return {
    version: OBJECT_CACHE_VERSION,
    updatedAt: manifest.updatedAt,
    entries: keep,
  };
}

async function _upsertSnapshot(snapshot: ObjectCacheSnapshot): Promise<void> {
  const sizeBytes = await _writeSnapshot(snapshot);
  const manifest = await _readManifest();
  const remainingEntries = manifest.entries.filter(
    (entry) => !_sameCacheEntry(entry, snapshot.connectionId, snapshot.bucket, snapshot.prefix)
  );

  if (sizeBytes == null) {
    await _deleteSnapshotStorage(snapshot);
    await _writeManifest({
      version: OBJECT_CACHE_VERSION,
      updatedAt: snapshot.cachedAt,
      entries: remainingEntries,
    });
    return;
  }

  const nextManifest = await _pruneManifest({
    version: OBJECT_CACHE_VERSION,
    updatedAt: snapshot.cachedAt,
    entries: [
      {
        connectionId: snapshot.connectionId,
        bucket: snapshot.bucket,
        prefix: snapshot.prefix,
        fileName: _cacheFileName(snapshot.connectionId, snapshot.bucket, snapshot.prefix),
        cachedAt: snapshot.cachedAt,
        lastAccessedAt: snapshot.cachedAt,
        itemCount: snapshot.itemCount,
        sizeBytes,
      },
      ...remainingEntries,
    ],
  });

  await _writeManifest(nextManifest);
}

async function _touchSnapshotAccess(
  connectionId: string,
  bucket: string,
  prefix: string,
  cachedAt?: string,
  itemCount?: number
): Promise<void> {
  const manifest = await _readManifest();
  let changed = false;
  const now = new Date().toISOString();

  const nextEntries = manifest.entries.map((entry) => {
    if (!_sameCacheEntry(entry, connectionId, bucket, prefix)) {
      return entry;
    }

    changed = true;
    return {
      ...entry,
      cachedAt: cachedAt ?? entry.cachedAt,
      itemCount: itemCount ?? entry.itemCount,
      lastAccessedAt: now,
    };
  });

  if (!changed) return;

  const nextManifest = await _pruneManifest({
    version: OBJECT_CACHE_VERSION,
    updatedAt: now,
    entries: nextEntries,
  });
  await _writeManifest(nextManifest);
}

function _cacheSnapshotKey(snapshot: Pick<ObjectCacheSnapshot, 'connectionId' | 'bucket' | 'prefix'>) {
  return _buildPrefixCacheKey(snapshot.connectionId, snapshot.bucket, snapshot.prefix);
}

export const useObjectStore = create<ObjectState>((set, get) => ({
  currentConnectionId: '',
  currentBucket: '',
  currentPrefix: '',
  objects: [],
  selectedKeys: new Set<string>(),
  isLoading: false,
  _prefixCache: new Map(),

  setCurrentBucket: (currentConnectionId, currentBucket) =>
    set((state) => {
      const cacheKey = _buildPrefixCacheKey(currentConnectionId, currentBucket, '');
      const cached = state._prefixCache.get(cacheKey);
      return {
        currentConnectionId,
        currentBucket,
        currentPrefix: '',
        objects: cached ?? [],
        selectedKeys: new Set(),
      };
    }),

  setCurrentPrefix: (currentPrefix) => {
    const state = get();
    const currentCacheKey = _buildPrefixCacheKey(
      state.currentConnectionId,
      state.currentBucket,
      state.currentPrefix
    );

    if (state.objects.length > 0 || state._prefixCache.has(currentCacheKey)) {
      state._prefixCache.set(currentCacheKey, state.objects);
    }

    const nextCacheKey = _buildPrefixCacheKey(
      state.currentConnectionId,
      state.currentBucket,
      currentPrefix
    );
    const cached = state._prefixCache.get(nextCacheKey);

    set({
      currentPrefix,
      objects: cached ?? [],
      selectedKeys: new Set(),
    });
  },

  setObjects: (objects, options) => {
    const state = get();
    if (!state.currentConnectionId || !state.currentBucket) {
      set({ objects });
      return;
    }

    const cacheKey = _buildPrefixCacheKey(
      state.currentConnectionId,
      state.currentBucket,
      state.currentPrefix
    );
    state._prefixCache.set(cacheKey, objects);

    const cachedAt = options?.cachedAt ?? new Date().toISOString();
    if (options?.persist !== false) {
      void _upsertSnapshot({
        connectionId: state.currentConnectionId,
        bucket: state.currentBucket,
        prefix: state.currentPrefix,
        cachedAt,
        itemCount: objects.length,
        objects,
      });
    }

    set({ objects });
  },

  hasPrefixCache: (connectionId, bucket, prefix) =>
    get()._prefixCache.has(_buildPrefixCacheKey(connectionId, bucket, prefix)),

  loadCachedObjects: async (connectionId) => {
    const state = get();
    if (
      state.currentConnectionId === connectionId &&
      state._prefixCache.has(
        _buildPrefixCacheKey(connectionId, state.currentBucket, state.currentPrefix)
      )
    ) {
      return { hit: true, source: 'memory' };
    }

    if (!state.currentBucket) {
      return { hit: false, source: 'none' };
    }

    const snapshot = await _readSnapshot(connectionId, state.currentBucket, state.currentPrefix);
    if (!snapshot) {
      return { hit: false, source: 'none' };
    }

    const cacheKey = _cacheSnapshotKey(snapshot);
    state._prefixCache.set(cacheKey, snapshot.objects);
    set({ objects: snapshot.objects });
    void _touchSnapshotAccess(
      snapshot.connectionId,
      snapshot.bucket,
      snapshot.prefix,
      snapshot.cachedAt,
      snapshot.itemCount
    );

    return {
      hit: true,
      cachedAt: snapshot.cachedAt,
      source: 'disk',
    };
  },

  clearBucketSnapshots: async (connectionId, bucket) => {
    const state = get();
    const prefix = `${connectionId}:${bucket}:`;
    const nextPrefixCache = new Map(
      [...state._prefixCache].filter(([cacheKey]) => !cacheKey.startsWith(prefix))
    );

    const manifest = await _readManifest();
    const removedEntries = manifest.entries.filter(
      (entry) => entry.connectionId === connectionId && entry.bucket === bucket
    );

    await Promise.all(removedEntries.map((entry) => _deleteSnapshotStorage(entry)));
    await _writeManifest({
      version: OBJECT_CACHE_VERSION,
      updatedAt: new Date().toISOString(),
      entries: manifest.entries.filter(
        (entry) => !(entry.connectionId === connectionId && entry.bucket === bucket)
      ),
    });

    set({
      _prefixCache: nextPrefixCache,
      objects:
        state.currentConnectionId === connectionId && state.currentBucket === bucket
          ? []
          : state.objects,
    });
  },

  prewarmRecentObjects: async (connectionIds) => {
    if (connectionIds.length === 0) return;

    const manifest = await _pruneManifest(await _readManifest());
    await _writeManifest(manifest);

    const allowedIds = new Set(connectionIds);
    const recentRootEntries = manifest.entries
      .filter((entry) => entry.prefix === '' && allowedIds.has(entry.connectionId))
      .slice(0, MAX_PREWARM_PREFIXES);

    for (const entry of recentRootEntries) {
      try {
        const fresh = await S3Service.listObjectsFresh(entry.connectionId, entry.bucket, entry.prefix);
        const cachedAt = new Date().toISOString();
        const cacheKey = _buildPrefixCacheKey(entry.connectionId, entry.bucket, entry.prefix);
        const prefixCache = new Map(get()._prefixCache);
        prefixCache.set(cacheKey, fresh);
        set({ _prefixCache: prefixCache });

        await _upsertSnapshot({
          connectionId: entry.connectionId,
          bucket: entry.bucket,
          prefix: entry.prefix,
          cachedAt,
          itemCount: fresh.length,
          objects: fresh,
        });
      } catch {}
    }
  },

  setLoading: (isLoading) => set({ isLoading }),

  toggleSelection: (key) =>
    set((state) => {
      const next = new Set(state.selectedKeys);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return { selectedKeys: next };
    }),

  selectAll: () =>
    set((state) => ({
      selectedKeys: new Set(state.objects.filter((o) => !o.isFolder).map((o) => o.key)),
    })),

  clearSelection: () => set({ selectedKeys: new Set() }),

  isSelected: (key) => get().selectedKeys.has(key),

  breadcrumbs: () => {
    const { currentPrefix } = get();
    const parts = currentPrefix.split('/').filter(Boolean);
    const crumbs = [{ label: 'root', prefix: '' }];
    let accumulated = '';
    for (const part of parts) {
      accumulated += part + '/';
      crumbs.push({ label: part, prefix: accumulated });
    }
    return crumbs;
  },
}));
