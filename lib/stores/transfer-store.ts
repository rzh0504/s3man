import { create } from 'zustand';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { TransferFilter, TransferTask, TransferStatus } from '@/lib/types';
import { useSettingsStore, type TransferHistoryDays } from '@/lib/stores/settings-store';
import {
  cancelRegisteredTransfer,
  pauseRegisteredTransfer,
  resumeRegisteredTransfer,
} from '@/lib/transfer-controller';

const STORAGE_KEY = 's3man_transfers';
const STORAGE_FILE = `${FileSystem.documentDirectory ?? ''}s3man-transfers.json`;
const PERSIST_DEBOUNCE_MS = 250;

let persistTimer: ReturnType<typeof setTimeout> | null = null;

interface TransferState {
  tasks: TransferTask[];
  filter: TransferFilter;
  isLoaded: boolean;
  loadTasks: () => Promise<void>;
  pruneTasks: (retentionDays?: TransferHistoryDays) => void;
  clearHistory: () => void;
  setFilter: (filter: TransferFilter) => void;
  addTask: (task: TransferTask) => void;
  updateTask: (id: string, updates: Partial<TransferTask>) => void;
  removeTask: (id: string) => void;
  pauseTask: (id: string) => Promise<void>;
  resumeTask: (id: string) => Promise<void>;
  cancelTask: (id: string) => Promise<void>;
  filteredTasks: () => TransferTask[];
}

function normalizeTask(task: TransferTask): TransferTask {
  if (task.status === 'completed' || task.status === 'failed') return task;
  return {
    ...task,
    status: 'failed',
    supportsPause: false,
    error: task.error ?? 'Interrupted by app restart',
    completedAt: task.completedAt ?? new Date().toISOString(),
  };
}

function getStartOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function applyRetention(tasks: TransferTask[], retentionDays: TransferHistoryDays): TransferTask[] {
  const cutoff = getStartOfDay(new Date());
  cutoff.setDate(cutoff.getDate() - (retentionDays - 1));

  return tasks.filter((task) => {
    const taskDate = new Date(task.startedAt);
    if (Number.isNaN(taskDate.getTime())) return true;
    return getStartOfDay(taskDate).getTime() >= cutoff.getTime();
  });
}

function mergeTasks(primary: TransferTask[], secondary: TransferTask[]): TransferTask[] {
  const merged = [...primary];
  const ids = new Set(primary.map((task) => task.id));
  for (const task of secondary) {
    if (!ids.has(task.id)) {
      merged.push(task);
    }
  }
  return merged;
}

async function readStoredTasks(): Promise<TransferTask[]> {
  try {
    if (Platform.OS === 'web') {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as TransferTask[]) : [];
    }

    if (!FileSystem.documentDirectory) return [];

    const info = await FileSystem.getInfoAsync(STORAGE_FILE);
    if (!info.exists) return [];

    const raw = await FileSystem.readAsStringAsync(STORAGE_FILE);
    return raw ? (JSON.parse(raw) as TransferTask[]) : [];
  } catch {
    return [];
  }
}

async function writeStoredTasks(tasks: TransferTask[]): Promise<void> {
  const json = JSON.stringify(tasks);

  if (Platform.OS === 'web') {
    localStorage.setItem(STORAGE_KEY, json);
    return;
  }

  if (!FileSystem.documentDirectory) return;
  await FileSystem.writeAsStringAsync(STORAGE_FILE, json);
}

function schedulePersist(tasks: TransferTask[]) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void writeStoredTasks(tasks).catch(() => {});
  }, PERSIST_DEBOUNCE_MS);
}

export const useTransferStore = create<TransferState>((set, get) => {
  const commitTasks = (updater: (tasks: TransferTask[]) => TransferTask[]) => {
    const retentionDays = useSettingsStore.getState().transferHistoryDays;
    const tasks = applyRetention(updater(get().tasks), retentionDays);
    set({ tasks });
    schedulePersist(tasks);
  };

  return {
    tasks: [],
    filter: 'all',
    isLoaded: false,

    loadTasks: async () => {
      const retentionDays = useSettingsStore.getState().transferHistoryDays;
      const loadedTasks = applyRetention((await readStoredTasks()).map(normalizeTask), retentionDays);
      const mergedTasks = applyRetention(mergeTasks(get().tasks, loadedTasks), retentionDays);
      set({ tasks: mergedTasks, isLoaded: true });
      schedulePersist(mergedTasks);
    },

    pruneTasks: (retentionDays = useSettingsStore.getState().transferHistoryDays) => {
      const tasks = applyRetention(get().tasks, retentionDays);
      set({ tasks });
      schedulePersist(tasks);
    },

    clearHistory: () =>
      commitTasks((tasks) =>
        tasks.filter((task) => task.status === 'active' || task.status === 'pending')
      ),

    setFilter: (filter) => set({ filter }),

    addTask: (task) => commitTasks((tasks) => [task, ...tasks]),

    updateTask: (id, updates) =>
      commitTasks((tasks) => tasks.map((task) => (task.id === id ? { ...task, ...updates } : task))),

    removeTask: (id) => commitTasks((tasks) => tasks.filter((task) => task.id !== id)),

    pauseTask: async (id) => {
      const paused = await pauseRegisteredTransfer(id).catch(() => false);
      if (!paused) return;
      commitTasks((tasks) =>
        tasks.map((task) =>
          task.id === id ? { ...task, status: 'paused' as TransferStatus } : task
        )
      );
    },

    resumeTask: async (id) => {
      const resumed = await resumeRegisteredTransfer(id).catch(() => false);
      if (!resumed) return;
      commitTasks((tasks) =>
        tasks.map((task) =>
          task.id === id ? { ...task, status: 'active' as TransferStatus } : task
        )
      );
    },

    cancelTask: async (id) => {
      await cancelRegisteredTransfer(id).catch(() => false);
      commitTasks((tasks) =>
        tasks.map((task) =>
          task.id === id ? { ...task, status: 'failed' as TransferStatus, error: 'Cancelled' } : task
        )
      );
    },

    filteredTasks: () => {
      const { tasks, filter } = get();
      switch (filter) {
        case 'upload':
          return tasks.filter((task) => task.type === 'upload');
        case 'download':
          return tasks.filter((task) => task.type === 'download');
        default:
          return tasks;
      }
    },
  };
});
