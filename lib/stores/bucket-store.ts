import { create } from 'zustand';
import type { BucketInfo } from '@/lib/types';

interface BucketState {
  /** All buckets across all connections */
  buckets: BucketInfo[];
  isLoading: boolean;
  filterRegion: string; // '' means all regions
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
  filterRegion: '',

  setBucketsForConnection: (connectionId, newBuckets) =>
    set((state) => ({
      buckets: [
        // Keep buckets from other connections
        ...state.buckets.filter((b) => b.connectionId !== connectionId),
        // Add new buckets for this connection
        ...newBuckets,
      ],
    })),

  removeBucketsForConnection: (connectionId) =>
    set((state) => ({
      buckets: state.buckets.filter((b) => b.connectionId !== connectionId),
    })),

  clearAll: () => set({ buckets: [] }),
  setLoading: (isLoading) => set({ isLoading }),
  setFilterRegion: (filterRegion) => set({ filterRegion }),
}));
