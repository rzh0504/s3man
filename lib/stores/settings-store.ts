import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { Uniwind } from 'uniwind';
import { useI18nStore, type Locale } from '@/lib/i18n';

const STORAGE_KEY = 's3man_settings';
export type AppTheme = 'light' | 'dark';
export type TransferHistoryDays = 1 | 3 | 7;
export type TransferConcurrency = 1 | 2 | 3;

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
  theme: AppTheme;
  language: Locale;
  transferHistoryDays: TransferHistoryDays;
  transferConcurrency: TransferConcurrency;
  downloadDirectoryUri: string | null;
  downloadDirectoryName: string | null;
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  setShowThumbnails: (value: boolean) => void;
  setTheme: (value: AppTheme) => void;
  setLanguage: (value: Locale) => void;
  setTransferHistoryDays: (value: TransferHistoryDays) => void;
  setTransferConcurrency: (value: TransferConcurrency) => void;
  setDownloadDirectory: (value: { uri: string; name: string } | null) => void;
}

function buildPersistedSettings({
  showThumbnails,
  theme,
  language,
  transferHistoryDays,
  transferConcurrency,
  downloadDirectoryUri,
  downloadDirectoryName,
}: {
  showThumbnails: boolean;
  theme: AppTheme;
  language: Locale;
  transferHistoryDays: TransferHistoryDays;
  transferConcurrency: TransferConcurrency;
  downloadDirectoryUri: string | null;
  downloadDirectoryName: string | null;
}) {
  return {
    showThumbnails,
    theme,
    language,
    transferHistoryDays,
    transferConcurrency,
    downloadDirectoryUri,
    downloadDirectoryName,
  };
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  showThumbnails: false,
  theme: 'light',
  language: 'zh',
  transferHistoryDays: 1,
  transferConcurrency: 2,
  downloadDirectoryUri: null,
  downloadDirectoryName: null,
  isLoaded: false,

  loadSettings: async () => {
    const data = await loadFromStorage();
    if (data) {
      const lang = (data.language as Locale) || 'zh';
      const theme: AppTheme = data.theme === 'dark' ? 'dark' : 'light';
      const transferHistoryDays =
        data.transferHistoryDays === 3 || data.transferHistoryDays === 7 ? data.transferHistoryDays : 1;
      const transferConcurrency =
        data.transferConcurrency === 1 || data.transferConcurrency === 3 ? data.transferConcurrency : 2;
      set({
        showThumbnails: !!data.showThumbnails,
        theme,
        language: lang,
        transferHistoryDays,
        transferConcurrency,
        downloadDirectoryUri:
          typeof data.downloadDirectoryUri === 'string' ? data.downloadDirectoryUri : null,
        downloadDirectoryName:
          typeof data.downloadDirectoryName === 'string' ? data.downloadDirectoryName : null,
        isLoaded: true,
      });
      Uniwind.setTheme(theme);
      useI18nStore.getState().setLocale(lang);
    } else {
      set({ isLoaded: true });
    }
  },

  setShowThumbnails: (value: boolean) => {
    set({ showThumbnails: value });
    saveToStorage(
      buildPersistedSettings({
        showThumbnails: value,
        theme: get().theme,
        language: get().language,
        transferHistoryDays: get().transferHistoryDays,
        transferConcurrency: get().transferConcurrency,
        downloadDirectoryUri: get().downloadDirectoryUri,
        downloadDirectoryName: get().downloadDirectoryName,
      })
    );
  },

  setTheme: (value: AppTheme) => {
    set({ theme: value });
    Uniwind.setTheme(value);
    saveToStorage(
      buildPersistedSettings({
        showThumbnails: get().showThumbnails,
        theme: value,
        language: get().language,
        transferHistoryDays: get().transferHistoryDays,
        transferConcurrency: get().transferConcurrency,
        downloadDirectoryUri: get().downloadDirectoryUri,
        downloadDirectoryName: get().downloadDirectoryName,
      })
    );
  },

  setLanguage: (value: Locale) => {
    set({ language: value });
    useI18nStore.getState().setLocale(value);
    saveToStorage(
      buildPersistedSettings({
        showThumbnails: get().showThumbnails,
        theme: get().theme,
        language: value,
        transferHistoryDays: get().transferHistoryDays,
        transferConcurrency: get().transferConcurrency,
        downloadDirectoryUri: get().downloadDirectoryUri,
        downloadDirectoryName: get().downloadDirectoryName,
      })
    );
  },

  setTransferHistoryDays: (value: TransferHistoryDays) => {
    set({ transferHistoryDays: value });
    saveToStorage(
      buildPersistedSettings({
        showThumbnails: get().showThumbnails,
        theme: get().theme,
        language: get().language,
        transferHistoryDays: value,
        transferConcurrency: get().transferConcurrency,
        downloadDirectoryUri: get().downloadDirectoryUri,
        downloadDirectoryName: get().downloadDirectoryName,
      })
    );
  },

  setTransferConcurrency: (value: TransferConcurrency) => {
    set({ transferConcurrency: value });
    saveToStorage(
      buildPersistedSettings({
        showThumbnails: get().showThumbnails,
        theme: get().theme,
        language: get().language,
        transferHistoryDays: get().transferHistoryDays,
        transferConcurrency: value,
        downloadDirectoryUri: get().downloadDirectoryUri,
        downloadDirectoryName: get().downloadDirectoryName,
      })
    );
  },

  setDownloadDirectory: (value) => {
    set({
      downloadDirectoryUri: value?.uri ?? null,
      downloadDirectoryName: value?.name ?? null,
    });
    saveToStorage(
      buildPersistedSettings({
        showThumbnails: get().showThumbnails,
        theme: get().theme,
        language: get().language,
        transferHistoryDays: get().transferHistoryDays,
        transferConcurrency: get().transferConcurrency,
        downloadDirectoryUri: value?.uri ?? null,
        downloadDirectoryName: value?.name ?? null,
      })
    );
  },
}));
