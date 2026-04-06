import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { downloadAppUpdate, installDownloadedApk } from '@/lib/updates/download';
import { checkForAppUpdate } from '@/lib/updates/manifest';
import type {
  AppVersionInfo,
  UpdateCheckResult,
  UpdateManifest,
  UpdateStatus,
} from '@/lib/updates/types';
import { getCurrentAppVersion } from '@/lib/updates/version';
import { useSettingsStore } from '@/lib/stores/settings-store';

const AUTO_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

type CheckMode = 'auto' | 'manual';

interface AppUpdateState {
  currentVersion: AppVersionInfo;
  status: UpdateStatus;
  latestManifest: UpdateManifest | null;
  downloadedFileUri: string | null;
  downloadedVersionCode: number | null;
  progress: number | null;
  error: string | null;
  checkForUpdates: (options?: {
    mode?: CheckMode;
    force?: boolean;
  }) => Promise<UpdateCheckResult | null>;
  downloadAvailableUpdate: () => Promise<void>;
  installAvailableUpdate: () => Promise<void>;
  ignoreAvailableUpdate: () => void;
  clearError: () => void;
}

function resolveDownloadedFile(manifest: UpdateManifest | null) {
  const settings = useSettingsStore.getState();

  if (
    !manifest ||
    settings.downloadedAppUpdateVersionCode !== manifest.versionCode ||
    !settings.downloadedAppUpdateFileUri
  ) {
    return null;
  }

  const file = new File(settings.downloadedAppUpdateFileUri);
  if (!file.exists) {
    settings.setDownloadedAppUpdate(null);
    return null;
  }

  return settings.downloadedAppUpdateFileUri;
}

function shouldSkipAutoCheck(force: boolean) {
  if (force) {
    return false;
  }

  const lastCheckAt = useSettingsStore.getState().lastAppUpdateCheckAt;
  if (!lastCheckAt) {
    return false;
  }

  return Date.now() - lastCheckAt < AUTO_CHECK_INTERVAL_MS;
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  currentVersion: getCurrentAppVersion(),
  status: 'idle',
  latestManifest: null,
  downloadedFileUri: null,
  downloadedVersionCode: null,
  progress: null,
  error: null,

  checkForUpdates: async ({ mode = 'manual', force = false } = {}) => {
    if (Platform.OS !== 'android') {
      return null;
    }

    const currentVersion = getCurrentAppVersion();
    const settings = useSettingsStore.getState();

    if (mode === 'auto' && shouldSkipAutoCheck(force)) {
      set({ currentVersion });
      return null;
    }

    set({
      currentVersion,
      status: 'checking',
      error: null,
      progress: null,
    });

    const result = await checkForAppUpdate();

    if (result.status === 'error') {
      set({
        currentVersion,
        status: 'error',
        error: result.message,
      });
      return result;
    }

    settings.setLastAppUpdateCheckAt(Date.now());

    if (
      settings.downloadedAppUpdateVersionCode &&
      currentVersion.versionCode >= settings.downloadedAppUpdateVersionCode
    ) {
      settings.setDownloadedAppUpdate(null);
    }

    if (result.status === 'updateAvailable') {
      const ignoredVersionCode = settings.ignoredAppUpdateVersionCode;
      const downloadedFileUri = resolveDownloadedFile(result.manifest);
      const isIgnored = mode === 'auto' && ignoredVersionCode === result.manifest.versionCode;

      set({
        currentVersion,
        latestManifest: result.manifest,
        downloadedFileUri,
        downloadedVersionCode: downloadedFileUri ? result.manifest.versionCode : null,
        progress: downloadedFileUri ? 100 : null,
        error: null,
        status: isIgnored ? 'upToDate' : downloadedFileUri ? 'downloaded' : 'updateAvailable',
      });

      return result;
    }

    set({
      currentVersion,
      latestManifest: result.manifest,
      downloadedFileUri: null,
      downloadedVersionCode: null,
      progress: null,
      error: null,
      status: 'upToDate',
    });

    return result;
  },

  downloadAvailableUpdate: async () => {
    const manifest = get().latestManifest;
    if (!manifest) {
      throw new Error('No update is available to download');
    }

    set({
      status: 'downloading',
      progress: 0,
      error: null,
    });

    try {
      const downloaded = await downloadAppUpdate(manifest, (progress) => {
        set({ progress });
      });

      useSettingsStore.getState().setIgnoredAppUpdateVersionCode(null);
      useSettingsStore.getState().setDownloadedAppUpdate({
        versionCode: manifest.versionCode,
        fileUri: downloaded.fileUri,
      });

      set({
        status: 'downloaded',
        downloadedFileUri: downloaded.fileUri,
        downloadedVersionCode: manifest.versionCode,
        progress: 100,
        error: null,
      });
    } catch (error) {
      set({
        status: 'updateAvailable',
        progress: null,
        error: error instanceof Error ? error.message : 'Failed to download update',
      });
      throw error;
    }
  },

  installAvailableUpdate: async () => {
    const { downloadedFileUri, latestManifest } = get();

    if (!downloadedFileUri || !latestManifest) {
      throw new Error('No downloaded update is ready to install');
    }

    const file = new File(downloadedFileUri);
    if (!file.exists) {
      useSettingsStore.getState().setDownloadedAppUpdate(null);
      set({
        status: 'updateAvailable',
        downloadedFileUri: null,
        downloadedVersionCode: null,
        progress: null,
      });
      throw new Error('Downloaded APK no longer exists');
    }

    await installDownloadedApk(downloadedFileUri);
  },

  ignoreAvailableUpdate: () => {
    const manifest = get().latestManifest;
    if (!manifest) {
      return;
    }

    useSettingsStore.getState().setIgnoredAppUpdateVersionCode(manifest.versionCode);
    set({
      status: 'upToDate',
      error: null,
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
