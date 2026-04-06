import Constants from 'expo-constants';

import type { UpdateCheckResult, UpdateManifest } from '@/lib/updates/types';
import { getCurrentAppVersion } from '@/lib/updates/version';

const DEFAULT_MANIFEST_URL =
  'https://github.com/rzh0504/s3man/releases/latest/download/update.json';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toSafeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseUpdateManifest(value: unknown): UpdateManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid update manifest payload');
  }

  const manifest = value as Record<string, unknown>;
  const versionCode = toSafeNumber(manifest.versionCode);
  const sizeBytes = toSafeNumber(manifest.sizeBytes);

  if (
    !isNonEmptyString(manifest.version) ||
    versionCode === null ||
    !isNonEmptyString(manifest.publishedAt) ||
    !isNonEmptyString(manifest.notes) ||
    !isNonEmptyString(manifest.apkUrl) ||
    !isNonEmptyString(manifest.sha256) ||
    sizeBytes === null
  ) {
    throw new Error('Update manifest is missing required fields');
  }

  if (Number.isNaN(Date.parse(manifest.publishedAt))) {
    throw new Error('Update manifest publishedAt is invalid');
  }

  if (!/^https?:\/\//i.test(manifest.apkUrl)) {
    throw new Error('Update manifest apkUrl must be an absolute URL');
  }

  if (!/^[A-Fa-f0-9]{64}$/.test(manifest.sha256)) {
    throw new Error('Update manifest sha256 must be a valid SHA-256 hash');
  }

  return {
    version: manifest.version.trim(),
    versionCode,
    publishedAt: manifest.publishedAt,
    notes: manifest.notes.trim(),
    apkUrl: manifest.apkUrl,
    sha256: manifest.sha256.toLowerCase(),
    sizeBytes,
  };
}

export function getUpdateManifestUrl() {
  const extra = Constants.expoConfig?.extra as { appUpdateManifestUrl?: string } | undefined;
  return extra?.appUpdateManifestUrl ?? DEFAULT_MANIFEST_URL;
}

export async function fetchUpdateManifest(): Promise<UpdateManifest> {
  const response = await fetch(getUpdateManifestUrl(), {
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(`Update check failed (${response.status})`);
  }

  return parseUpdateManifest(await response.json());
}

export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = getCurrentAppVersion();

  try {
    const manifest = await fetchUpdateManifest();

    if (manifest.versionCode > currentVersion.versionCode) {
      return {
        status: 'updateAvailable',
        currentVersionCode: currentVersion.versionCode,
        manifest,
      };
    }

    return {
      status: 'upToDate',
      currentVersionCode: currentVersion.versionCode,
      manifest,
    };
  } catch (error) {
    return {
      status: 'error',
      currentVersionCode: currentVersion.versionCode,
      message: error instanceof Error ? error.message : 'Failed to check for updates',
    };
  }
}
