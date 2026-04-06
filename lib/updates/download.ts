import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { File, Directory, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

import { canRequestPackageInstalls } from '@/lib/updates/native';
import type { DownloadedUpdate, UpdateManifest } from '@/lib/updates/types';

const APK_MIME_TYPE = 'application/vnd.android.package-archive';
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const FLAG_ACTIVITY_NEW_TASK = 268435456;
const UPDATE_DIRECTORY = new Directory(Paths.document, 'updates');

function ensureUpdateDirectory() {
  UPDATE_DIRECTORY.create({ idempotent: true, intermediates: true });
  return UPDATE_DIRECTORY;
}

function arrayBufferToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256File(fileUri: string) {
  const file = new File(fileUri);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes());
  return arrayBufferToHex(digest);
}

function getTargetApkFile(manifest: UpdateManifest) {
  const directory = ensureUpdateDirectory();
  return new File(directory, `s3man-${manifest.versionCode}.apk`);
}

export async function downloadAppUpdate(
  manifest: UpdateManifest,
  onProgress?: (progress: number) => void
): Promise<DownloadedUpdate> {
  if (Platform.OS !== 'android') {
    throw new Error('In-app APK updates are only supported on Android');
  }

  const targetFile = getTargetApkFile(manifest);
  if (targetFile.exists) {
    targetFile.delete();
  }

  const resumable = FileSystem.createDownloadResumable(
    manifest.apkUrl,
    targetFile.uri,
    {},
    (event) => {
      if (!event.totalBytesExpectedToWrite) {
        onProgress?.(0);
        return;
      }

      onProgress?.((event.totalBytesWritten / event.totalBytesExpectedToWrite) * 100);
    }
  );

  const result = await resumable.downloadAsync();
  const fileUri = result?.uri;

  if (!fileUri) {
    throw new Error('APK download was interrupted');
  }

  const actualHash = await sha256File(fileUri);
  if (actualHash !== manifest.sha256.toLowerCase()) {
    new File(fileUri).delete();
    throw new Error('Downloaded APK failed integrity verification');
  }

  const contentUri = await FileSystem.getContentUriAsync(fileUri);

  return {
    manifest,
    fileUri,
    contentUri,
  };
}

async function ensureInstallPermission() {
  const applicationId = Application.applicationId;
  if (!applicationId) {
    throw new Error('Unable to resolve application package name');
  }

  let isAllowed = await canRequestPackageInstalls();
  if (isAllowed) {
    return;
  }

  await IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,
    {
      data: `package:${applicationId}`,
    }
  );

  isAllowed = await canRequestPackageInstalls();
  if (!isAllowed) {
    throw new Error('Install permission not granted');
  }
}

export async function installDownloadedApk(fileUri: string): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('In-app APK updates are only supported on Android');
  }

  const file = new File(fileUri);
  if (!file.exists) {
    throw new Error('Downloaded APK no longer exists');
  }

  await ensureInstallPermission();

  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: await FileSystem.getContentUriAsync(fileUri),
    flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
    type: APK_MIME_TYPE,
  });
}
