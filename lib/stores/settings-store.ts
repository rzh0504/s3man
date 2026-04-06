import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { useI18nStore, type Locale } from '@/lib/i18n';

const STORAGE_KEY = 's3man_settings';
export type TransferHistoryDays = 1 | 3 | 7;

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
  language: Locale;
  transferHistoryDays: TransferHistoryDays;
  downloadDirectoryUri: string | null;
  downloadDirectoryName: string | null;
  lastAppUpdateCheckAt: number | null;
  ignoredAppUpdateVersionCode: number | null;
  downloadedAppUpdateVersionCode: number | null;
  downloadedAppUpdateFileUri: string | null;
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  setShowThumbnails: (value: boolean) => void;
  setLanguage: (value: Locale) => void;
  setTransferHistoryDays: (value: TransferHistoryDays) => void;
  setDownloadDirectory: (value: { uri: string; name: string } | null) => void;
  setLastAppUpdateCheckAt: (value: number | null) => void;
  setIgnoredAppUpdateVersionCode: (value: number | null) => void;
  setDownloadedAppUpdate: (value: { versionCode: number; fileUri: string } | null) => void;
}

function buildPersistedSettings({
  showThumbnails,
  language,
  transferHistoryDays,
  downloadDirectoryUri,
  downloadDirectoryName,
  lastAppUpdateCheckAt,
  ignoredAppUpdateVersionCode,
  downloadedAppUpdateVersionCode,
  downloadedAppUpdateFileUri,
}: {
  showThumbnails: boolean;
  language: Locale;
  transferHistoryDays: TransferHistoryDays;
  downloadDirectoryUri: string | null;
  downloadDirectoryName: string | null;
  lastAppUpdateCheckAt: number | null;
  ignoredAppUpdateVersionCode: number | null;
  downloadedAppUpdateVersionCode: number | null;
  downloadedAppUpdateFileUri: string | null;
}) {
  return {
    showThumbnails,
    language,
    transferHistoryDays,
    downloadDirectoryUri,
    downloadDirectoryName,
    lastAppUpdateCheckAt,
    ignoredAppUpdateVersionCode,
    downloadedAppUpdateVersionCode,
    downloadedAppUpdateFileUri,
  };
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  showThumbnails: false,
  language: 'zh',
  transferHistoryDays: 1,
  downloadDirectoryUri: null,
  downloadDirectoryName: null,
  lastAppUpdateCheckAt: null,
  ignoredAppUpdateVersionCode: null,
  downloadedAppUpdateVersionCode: null,
  downloadedAppUpdateFileUri: null,
  isLoaded: false,

  loadSettings: async () => {
    const data = await loadFromStorage();
    if (data) {
      const lang = (data.language as Locale) || 'zh';
      const transferHistoryDays =
        data.transferHistoryDays === 3 || data.transferHistoryDays === 7
          ? data.transferHistoryDays
          : 1;
      set({
        showThumbnails: !!data.showThumbnails,
        language: lang,
        transferHistoryDays,
        downloadDirectoryUri:
          typeof data.downloadDirectoryUri === 'string' ? data.downloadDirectoryUri : null,
        downloadDirectoryName:
          typeof data.downloadDirectoryName === 'string' ? data.downloadDirectoryName : null,
        lastAppUpdateCheckAt:
          typeof data.lastAppUpdateCheckAt === 'number' ? data.lastAppUpdateCheckAt : null,
        ignoredAppUpdateVersionCode:
          typeof data.ignoredAppUpdateVersionCode === 'number'
            ? data.ignoredAppUpdateVersionCode
            : null,
        downloadedAppUpdateVersionCode:
          typeof data.downloadedAppUpdateVersionCode === 'number'
            ? data.downloadedAppUpdateVersionCode
            : null,
        downloadedAppUpdateFileUri:
          typeof data.downloadedAppUpdateFileUri === 'string'
            ? data.downloadedAppUpdateFileUri
            : null,
        isLoaded: true,
      });
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
        language: get().language,
        transferHistoryDays: get().transferHistoryDays,
        downloadDirectoryUri: get().downloadDirectoryUri,
        downloadDirectoryName: get().downloadDirectoryName,
        lastAppUpdateCheckAt: get().lastAppUpdateCheckAt,
        ignoredAppUpdateVersionCode: get().ignoredAppUpdateVersionCode,
        downloadedAppUpdateVersionCode: get().downloadedAppUpdateVersionCode,
        downloadedAppUpdateFileUri: get().downloadedAppUpdateFileUri,
      })
    );
  },

  setLanguage: (value: Locale) => {
    set({ language: value });
    useI18nStore.getState().setLocale(value);
    saveToStorage(
      buildPersistedSettings({
        showThumbnails: get().showThumbnails,
        language: value,
        transferHistoryDays: get().transferHistoryDays,
        downloadDirectoryUri: get().downloadDirectoryUri,
        downloadDirectoryName: get().downloadDirectoryName,
        lastAppUpdateCheckAt: get().lastAppUpdateCheckAt,
        ignoredAppUpdateVersionCode: get().ignoredAppUpdateVersionCode,
        downloadedAppUpdateVersionCode: get().downloadedAppUpdateVersionCode,
        downloadedAppUpdateFileUri: get().downloadedAppUpdateFileUri,
      })
    );
  },

  setTransferHistoryDays: (value: TransferHistoryDays) => {
    set({ transferHistoryDays: value });
    saveToStorage(
      buildPersistedSettings({
        showThumbnails: get().showThumbnails,
        language: get().language,
        transferHistoryDays: value,
        downloadDirectoryUri: get().downloadDirectoryUri,
        downloadDirectoryName: get().downloadDirectoryName,
        lastAppUpdateCheckAt: get().lastAppUpdateCheckAt,
        ignoredAppUpdateVersionCode: get().ignoredAppUpdateVersionCode,
        downloadedAppUpdateVersionCode: get().downloadedAppUpdateVersionCode,
        downloadedAppUpdateFileUri: get().downloadedAppUpdateFileUri,
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
        language: get().language,
        transferHistoryDays: get().transferHistoryDays,
        downloadDirectoryUri: value?.uri ?? null,
        downloadDirectoryName: value?.name ?? null,
        lastAppUpdateCheckAt: get().lastAppUpdateCheckAt,
        ignoredAppUpdateVersionCode: get().ignoredAppUpdateVersionCode,
        downloadedAppUpdateVersionCode: get().downloadedAppUpdateVersionCode,
        downloadedAppUpdateFileUri: get().downloadedAppUpdateFileUri,
      })
    );
  },

  setLastAppUpdateCheckAt: (value) => {
    set({ lastAppUpdateCheckAt: value });
    saveToStorage(
      buildPersistedSettings({
        showThumbnails: get().showThumbnails,
        language: get().language,
        transferHistoryDays: get().transferHistoryDays,
        downloadDirectoryUri: get().downloadDirectoryUri,
        downloadDirectoryName: get().downloadDirectoryName,
        lastAppUpdateCheckAt: value,
        ignoredAppUpdateVersionCode: get().ignoredAppUpdateVersionCode,
        downloadedAppUpdateVersionCode: get().downloadedAppUpdateVersionCode,
        downloadedAppUpdateFileUri: get().downloadedAppUpdateFileUri,
      })
    );
  },

  setIgnoredAppUpdateVersionCode: (value) => {
    set({ ignoredAppUpdateVersionCode: value });
    saveToStorage(
      buildPersistedSettings({
        showThumbnails: get().showThumbnails,
        language: get().language,
        transferHistoryDays: get().transferHistoryDays,
        downloadDirectoryUri: get().downloadDirectoryUri,
        downloadDirectoryName: get().downloadDirectoryName,
        lastAppUpdateCheckAt: get().lastAppUpdateCheckAt,
        ignoredAppUpdateVersionCode: value,
        downloadedAppUpdateVersionCode: get().downloadedAppUpdateVersionCode,
        downloadedAppUpdateFileUri: get().downloadedAppUpdateFileUri,
      })
    );
  },

  setDownloadedAppUpdate: (value) => {
    set({
      downloadedAppUpdateVersionCode: value?.versionCode ?? null,
      downloadedAppUpdateFileUri: value?.fileUri ?? null,
    });
    saveToStorage(
      buildPersistedSettings({
        showThumbnails: get().showThumbnails,
        language: get().language,
        transferHistoryDays: get().transferHistoryDays,
        downloadDirectoryUri: get().downloadDirectoryUri,
        downloadDirectoryName: get().downloadDirectoryName,
        lastAppUpdateCheckAt: get().lastAppUpdateCheckAt,
        ignoredAppUpdateVersionCode: get().ignoredAppUpdateVersionCode,
        downloadedAppUpdateVersionCode: value?.versionCode ?? null,
        downloadedAppUpdateFileUri: value?.fileUri ?? null,
      })
    );
  },
}));
