import { create } from 'zustand';
import type { TransferFilter, TransferTask, TransferStatus } from '@/lib/types';

interface TransferState {
  tasks: TransferTask[];
  filter: TransferFilter;
  setFilter: (filter: TransferFilter) => void;
  addTask: (task: TransferTask) => void;
  updateTask: (id: string, updates: Partial<TransferTask>) => void;
  removeTask: (id: string) => void;
  pauseTask: (id: string) => void;
  resumeTask: (id: string) => void;
  cancelTask: (id: string) => void;
  filteredTasks: () => TransferTask[];
}

export const useTransferStore = create<TransferState>((set, get) => ({
  tasks: [],
  filter: 'all',

  setFilter: (filter) => set({ filter }),

  addTask: (task) =>
    set((state) => ({ tasks: [task, ...state.tasks] })),

  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    })),

  pauseTask: (id) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, status: 'paused' as TransferStatus } : t
      ),
    })),

  resumeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, status: 'active' as TransferStatus } : t
      ),
    })),

  cancelTask: (id) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, status: 'failed' as TransferStatus, error: 'Cancelled' } : t
      ),
    })),

  filteredTasks: () => {
    const { tasks, filter } = get();
    switch (filter) {
      case 'uploading':
        return tasks.filter((t) => t.type === 'upload' && t.status !== 'completed');
      case 'downloading':
        return tasks.filter((t) => t.type === 'download' && t.status !== 'completed');
      case 'completed':
        return tasks.filter((t) => t.status === 'completed');
      default:
        return tasks;
    }
  },
}));
