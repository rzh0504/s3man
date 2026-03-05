import { create } from 'zustand';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import type { BucketInfo } from '@/lib/types';

const BUCKET_CACHE_KEY = 's3man_bucket_cache';

function _getCacheFile() {
  return new File(Paths.document, `${BUCKET_CACHE_KEY}.json`);
}

async function _persistBuckets(buckets: BucketInfo[]) {
  try {
    const json = JSON.stringify(buckets);
    if (Platform.OS === 'web') {
      localStorage.setItem(BUCKET_CACHE_KEY, json);
    } else {
      _getCacheFile().write(json);
    }
  } catch {}
}

async function _loadCachedBuckets(): Promise<BucketInfo[]> {
  try {
    let json: string | null = null;
    if (Platform.OS === 'web') {
      json = localStorage.getItem(BUCKET_CACHE_KEY);
    } else {
      const file = _getCacheFile();
      if (file.exists) {
        json = await file.text();
      }
    }
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

interface BucketState {
  /** All buckets across all connections */
  buckets: BucketInfo[];
  isLoading: boolean;
  /** true once cached or fetched data has been loaded */
  hasCachedData: boolean;
  filterRegion: string; // '' means all regions
  /** Load cached buckets from disk on startup */
  loadCachedBuckets: () => Promise<void>;
  /** Set buckets for a specific connection (merges with others) */
  setBucketsForConnection: (connectionId: string, buckets: BucketInfo[]) => void;
  /** Remove all buckets for a connection */
  removeBucketsForConnection: (connectionId: string) => void;
  /** Clear everything */
  clearAll: () => void;
  setLoading: (loading: boolean) => void;
  setFilterRegion: (region: string) => void;
}

export const useBucketStore = create<BucketState>((set, get) => ({
  buckets: [],
  isLoading: false,
  hasCachedData: false,
  filterRegion: '',

  loadCachedBuckets: async () => {
    const cached = await _loadCachedBuckets();
    if (cached.length > 0) {
      set({ buckets: cached, hasCachedData: true });
    }
  },

  setBucketsForConnection: (connectionId, newBuckets) =>
    set((state) => {
      const buckets = [
        ...state.buckets.filter((b) => b.connectionId !== connectionId),
        ...newBuckets,
      ];
      _persistBuckets(buckets);
      return { buckets, hasCachedData: true };
    }),

  removeBucketsForConnection: (connectionId) =>
    set((state) => {
      const buckets = state.buckets.filter((b) => b.connectionId !== connectionId);
      _persistBuckets(buckets);
      return { buckets };
    }),

  clearAll: () => {
    _persistBuckets([]);
    set({ buckets: [], hasCachedData: false });
  },
  setLoading: (isLoading) => set({ isLoading }),
  setFilterRegion: (filterRegion) => set({ filterRegion }),
}));
