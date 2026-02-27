import { create } from 'zustand';
import type { ConnectionStatus, S3Config } from '@/lib/types';
import { DEFAULT_ENDPOINT, DEFAULT_REGION, DEFAULT_PROVIDER } from '@/lib/constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const STORAGE_KEY = 's3man_config';

interface ConnectionState {
  config: S3Config;
  status: ConnectionStatus;
  errorMessage: string;
  setConfig: (config: Partial<S3Config>) => void;
  setStatus: (status: ConnectionStatus, error?: string) => void;
  saveConfig: () => Promise<void>;
  loadConfig: () => Promise<void>;
  clearConfig: () => Promise<void>;
}

const DEFAULT_CONFIG: S3Config = {
  provider: DEFAULT_PROVIDER,
  endpointUrl: DEFAULT_ENDPOINT,
  accessKeyId: '',
  secretAccessKey: '',
  region: DEFAULT_REGION,
  accountId: '',
};

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  config: { ...DEFAULT_CONFIG },
  status: 'disconnected',
  errorMessage: '',

  setConfig: (partial) =>
    set((state) => ({
      config: { ...state.config, ...partial },
    })),

  setStatus: (status, error) =>
    set({ status, errorMessage: error ?? '' }),

  saveConfig: async () => {
    const { config } = get();
    const json = JSON.stringify(config);
    if (Platform.OS === 'web') {
      try {
        localStorage.setItem(STORAGE_KEY, json);
      } catch {}
    } else {
      await SecureStore.setItemAsync(STORAGE_KEY, json);
    }
  },

  loadConfig: async () => {
    try {
      let json: string | null = null;
      if (Platform.OS === 'web') {
        json = localStorage.getItem(STORAGE_KEY);
      } else {
        json = await SecureStore.getItemAsync(STORAGE_KEY);
      }
      if (json) {
        const saved = JSON.parse(json);
        // Merge with defaults to ensure new fields exist
        set({ config: { ...DEFAULT_CONFIG, ...saved } });
      }
    } catch {
      // ignore parse errors
    }
  },

  clearConfig: async () => {
    if (Platform.OS === 'web') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
    }
    set({
      config: { ...DEFAULT_CONFIG },
      status: 'disconnected',
      errorMessage: '',
    });
  },
}));
