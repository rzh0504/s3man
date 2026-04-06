export interface UpdateManifest {
  version: string;
  versionCode: number;
  publishedAt: string;
  notes: string;
  apkUrl: string;
  sha256: string;
  sizeBytes: number;
}

export interface AppVersionInfo {
  versionName: string;
  versionCode: number;
  displayVersion: string;
}

export type UpdateCheckResult =
  | {
      status: 'upToDate';
      currentVersionCode: number;
      manifest: UpdateManifest | null;
    }
  | {
      status: 'updateAvailable';
      currentVersionCode: number;
      manifest: UpdateManifest;
    }
  | {
      status: 'error';
      currentVersionCode: number;
      message: string;
    };

export interface DownloadedUpdate {
  manifest: UpdateManifest;
  fileUri: string;
  contentUri: string;
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'updateAvailable'
  | 'downloading'
  | 'downloaded'
  | 'error';
