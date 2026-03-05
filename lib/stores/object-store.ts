import { create } from 'zustand';
import { Platform } from 'react-native';
import { File, Paths, Directory } from 'expo-file-system';
import type { S3Object } from '@/lib/types';

// ── Disk persistence for object listings ─────────────────────────────────

const OBJECT_CACHE_DIR = 's3man_object_cache';

function _getCacheDir(): Directory {
  return new Directory(Paths.document, OBJECT_CACHE_DIR);
}

/** Sanitise a cache key into a safe filename */
function _cacheFileName(connectionId: string, bucket: string, prefix: string): string {
  const raw = `${connectionId}_${bucket}_${prefix}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
}

function _persistObjects(connectionId: string, bucket: string, prefix: string, objects: S3Object[]) {
  try {
    if (Platform.OS === 'web') {
      localStorage.setItem(`obj:${connectionId}:${bucket}:${prefix}`, JSON.stringify(objects));
    } else {
      const dir = _getCacheDir();
      if (!dir.exists) dir.create({ intermediates: true });
      const file = new File(dir, _cacheFileName(connectionId, bucket, prefix));
      file.write(JSON.stringify(objects));
    }
  } catch {}
}

async function _loadCachedObjects(
  connectionId: string,
  bucket: string,
  prefix: string
): Promise<S3Object[] | null> {
  try {
    if (Platform.OS === 'web') {
      const json = localStorage.getItem(`obj:${connectionId}:${bucket}:${prefix}`);
      return json ? JSON.parse(json) : null;
    } else {
      const file = new File(_getCacheDir(), _cacheFileName(connectionId, bucket, prefix));
      if (!file.exists) return null;
      const json = await file.text();
      return JSON.parse(json);
    }
  } catch {
    return null;
  }
}

interface ObjectState {
  currentBucket: string;
  currentPrefix: string;
  objects: S3Object[];
  selectedKeys: Set<string>;
  isLoading: boolean;
  /** Per-prefix cache so navigating back shows data instantly */
  _prefixCache: Map<string, S3Object[]>;
  setCurrentBucket: (bucket: string) => void;
  setCurrentPrefix: (prefix: string) => void;
  setObjects: (objects: S3Object[]) => void;
  /** Load objects from disk cache for current bucket+prefix */
  loadCachedObjects: (connectionId: string) => Promise<boolean>;
  setLoading: (loading: boolean) => void;
  toggleSelection: (key: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  isSelected: (key: string) => boolean;
  breadcrumbs: () => { label: string; prefix: string }[];
}

export const useObjectStore = create<ObjectState>((set, get) => ({
  currentBucket: '',
  currentPrefix: '',
  objects: [],
  selectedKeys: new Set<string>(),
  isLoading: false,
  _prefixCache: new Map(),

  setCurrentBucket: (currentBucket) =>
    set({ currentBucket, currentPrefix: '', objects: [], selectedKeys: new Set(), _prefixCache: new Map() }),

  setCurrentPrefix: (currentPrefix) => {
    const state = get();
    // Save current objects into prefix cache before switching
    if (state.objects.length > 0) {
      const cacheKey = `${state.currentBucket}:${state.currentPrefix}`;
      state._prefixCache.set(cacheKey, state.objects);
    }
    // Restore from cache if available (instant navigation)
    const newCacheKey = `${state.currentBucket}:${currentPrefix}`;
    const cached = state._prefixCache.get(newCacheKey);
    set({
      currentPrefix,
      objects: cached ?? [],
      selectedKeys: new Set(),
    });
  },

  setObjects: (objects) => {
    const state = get();
    // Also update the prefix cache
    const cacheKey = `${state.currentBucket}:${state.currentPrefix}`;
    state._prefixCache.set(cacheKey, objects);
    // Persist to disk in background
    _persistObjects('_current', state.currentBucket, state.currentPrefix, objects);
    set({ objects });
  },

  loadCachedObjects: async (connectionId) => {
    const state = get();
    // If in-memory cache already has data, skip disk read
    if (state.objects.length > 0) return true;
    const cached = await _loadCachedObjects(connectionId, state.currentBucket, state.currentPrefix);
    if (cached && cached.length > 0) {
      const cacheKey = `${state.currentBucket}:${state.currentPrefix}`;
      state._prefixCache.set(cacheKey, cached);
      set({ objects: cached });
      return true;
    }
    return false;
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
