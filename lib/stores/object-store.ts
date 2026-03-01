import { create } from 'zustand';
import type { S3Object } from '@/lib/types';

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
    set({ objects });
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
