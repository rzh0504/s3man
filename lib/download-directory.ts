import * as FileSystem from 'expo-file-system/legacy';

const APP_DOWNLOADS_FOLDER = 's3downloads';
const SAF_CHUNK_SIZE_BYTES = 768 * 1024;
const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;

export function isSafDirectoryUri(uri: string | null | undefined): uri is string {
  return !!uri && uri.startsWith('content://');
}

export function getAppDownloadDirectoryUri(): string {
  if (!FileSystem.documentDirectory) {
    throw new Error('Document directory is unavailable');
  }
  return `${FileSystem.documentDirectory}${APP_DOWNLOADS_FOLDER}/`;
}

export function sanitizeFileName(fileName: string): string {
  const sanitized = fileName.replace(INVALID_FILE_NAME_CHARS, '_').trim();
  return sanitized || 'download';
}

export function splitFileName(fileName: string): { baseName: string; extension: string } {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0) {
    return { baseName: fileName, extension: '' };
  }
  return {
    baseName: fileName.slice(0, lastDot),
    extension: fileName.slice(lastDot),
  };
}

export function getDownloadDirectoryNameFromUri(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    const match = decoded.match(/\/(?:document|tree)\/([^/?#]+)/i);
    const rawPath = match?.[1] ?? decoded;
    const simplePath = rawPath.includes(':') ? rawPath.slice(rawPath.indexOf(':') + 1) : rawPath;
    const normalized = simplePath
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join(' / ');
    return normalized || 'Selected folder';
  } catch {
    return 'Selected folder';
  }
}

export function formatDownloadDirectoryLabel(value: string | null | undefined): string {
  if (!value) return 'Selected folder';
  const decoded = (() => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  })();

  if (
    decoded.startsWith('content://') ||
    decoded.includes('/tree/') ||
    decoded.includes('/document/') ||
    decoded.includes('primary:')
  ) {
    const simplified = getDownloadDirectoryNameFromUri(decoded);
    const parts = simplified.split(' / ').filter(Boolean);
    if (parts.length === 0) return 'Selected folder';
    if (parts.length === 1) return parts[0];
    return parts.slice(-2).join(' / ');
  }

  return decoded;
}

export async function createUniqueAppDownloadUriAsync(fileName: string): Promise<string> {
  const directoryUri = getAppDownloadDirectoryUri();
  await FileSystem.makeDirectoryAsync(directoryUri, { intermediates: true });

  const safeName = sanitizeFileName(fileName);
  const { baseName, extension } = splitFileName(safeName);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidateName =
      attempt === 0 ? safeName : `${baseName} (${attempt})${extension}`;
    const candidateUri = `${directoryUri}${candidateName}`;
    const info = await FileSystem.getInfoAsync(candidateUri);
    if (!info.exists) {
      return candidateUri;
    }
  }

  throw new Error('Unable to create a unique download file name');
}

async function createSafTargetFileAsync(
  directoryUri: string,
  fileName: string,
  mimeType: string
): Promise<string> {
  const safeName = sanitizeFileName(fileName);
  const { baseName } = splitFileName(safeName);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidateBaseName = attempt === 0 ? baseName : `${baseName} (${attempt})`;
    try {
      return await FileSystem.StorageAccessFramework.createFileAsync(
        directoryUri,
        candidateBaseName,
        mimeType
      );
    } catch (error) {
      if (attempt === 99) {
        throw error;
      }
    }
  }

  throw new Error('Unable to create file in the selected directory');
}

export async function copyFileToSafDirectoryAsync(options: {
  sourceUri: string;
  directoryUri: string;
  fileName: string;
  mimeType: string;
}): Promise<string> {
  const { sourceUri, directoryUri, fileName, mimeType } = options;
  const sourceInfo = await FileSystem.getInfoAsync(sourceUri);
  const targetUri = await createSafTargetFileAsync(directoryUri, fileName, mimeType);

  if (!sourceInfo.exists) {
    throw new Error('Downloaded file was not found');
  }

  const totalBytes = typeof sourceInfo.size === 'number' ? sourceInfo.size : 0;
  if (totalBytes === 0) {
    return targetUri;
  }

  for (let position = 0; position < totalBytes; position += SAF_CHUNK_SIZE_BYTES) {
    const length = Math.min(SAF_CHUNK_SIZE_BYTES, totalBytes - position);
    const chunk = await FileSystem.readAsStringAsync(sourceUri, {
      encoding: FileSystem.EncodingType.Base64,
      position,
      length,
    });

    await FileSystem.writeAsStringAsync(targetUri, chunk, {
      encoding: FileSystem.EncodingType.Base64,
      append: position > 0,
    });
  }

  return targetUri;
}
