import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const STORAGE_KEY = 's3man_settings';

async function loadFromStorage(): Promise<Record<string, unknown> | null> {
  try {
    const raw =
      Platform.OS === 'web'
        ? localStorage.getItem(STORAGE_KEY)
        : await SecureStore.getItemAsync(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveToStorage(data: Record<string, unknown>) {
  const json = JSON.stringify(data);
  if (Platform.OS === 'web') {
    localStorage.setItem(STORAGE_KEY, json);
  } else {
    SecureStore.setItemAsync(STORAGE_KEY, json).catch(() => {});
  }
}

interface SettingsState {
  showThumbnails: boolean;
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  setShowThumbnails: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  showThumbnails: false,
  isLoaded: false,

  loadSettings: async () => {
    const data = await loadFromStorage();
    if (data) {
      set({ showThumbnails: !!data.showThumbnails, isLoaded: true });
    } else {
      set({ isLoaded: true });
    }
  },

  setShowThumbnails: (value: boolean) => {
    set({ showThumbnails: value });
    saveToStorage({ showThumbnails: value });
  },
}));
