/**
 * Lightweight in-memory TTL cache for S3 data (object listings & presigned URLs).
 *
 * Why not SQLite?
 * - Presigned URLs have built-in expiry; there's no value in persisting them across app restarts.
 * - Object listings change frequently; stale data from disk could be confusing.
 * - An in-memory Map with TTL is zero-dependency, instant, and perfectly suited here.
 */

interface CacheEntry<T> {
  data: T;
  /** Timestamp (ms) when this entry expires */
  expiresAt: number;
}

class TTLCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  /** Get a cached value. Returns `undefined` if missing or expired. */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  /** Store a value with a TTL in seconds. */
  set(key: string, data: T, ttlSeconds: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  /** Delete a specific key. */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Delete all keys matching a prefix (e.g. invalidate a whole bucket). */
  deleteByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /** Remove all expired entries (optional housekeeping). */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

// ── Singleton caches ─────────────────────────────────────────────────────────

import type { S3Object } from '@/lib/types';

/** Cache for listObjects results.  Key: `${connectionId}:${bucket}:${prefix}` */
export const objectListCache = new TTLCache<S3Object[]>();

/** Cache for presigned GET URLs.  Key: `${connectionId}:${bucket}:${objectKey}` */
export const presignedUrlCache = new TTLCache<string>();

// ── Helper key builders ──────────────────────────────────────────────────────

export function objectListCacheKey(connectionId: string, bucket: string, prefix: string): string {
  return `${connectionId}:${bucket}:${prefix}`;
}

export function presignedUrlCacheKey(connectionId: string, bucket: string, key: string): string {
  return `${connectionId}:${bucket}:${key}`;
}

/** Invalidate all object-list cache entries for a given bucket (e.g. after upload/delete). */
export function invalidateBucketCache(connectionId: string, bucket: string): void {
  objectListCache.deleteByPrefix(`${connectionId}:${bucket}:`);
}
