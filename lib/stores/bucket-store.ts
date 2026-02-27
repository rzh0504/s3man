import { create } from 'zustand';
import type { BucketInfo } from '@/lib/types';

interface BucketState {
  buckets: BucketInfo[];
  isLoading: boolean;
  filterRegion: string; // '' means all regions
  setBuckets: (buckets: BucketInfo[]) => void;
  setLoading: (loading: boolean) => void;
  setFilterRegion: (region: string) => void;
  filteredBuckets: () => BucketInfo[];
}

export const useBucketStore = create<BucketState>((set, get) => ({
  buckets: [],
  isLoading: false,
  filterRegion: '',

  setBuckets: (buckets) => set({ buckets }),
  setLoading: (isLoading) => set({ isLoading }),
  setFilterRegion: (filterRegion) => set({ filterRegion }),

  filteredBuckets: () => {
    const { buckets, filterRegion } = get();
    if (!filterRegion) return buckets;
    return buckets.filter((b) => b.region === filterRegion);
  },
}));
