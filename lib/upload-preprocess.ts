import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as S3Service from '@/lib/s3-service';

export type UploadImageCompression = 'original' | 'high' | 'medium' | 'low';

export interface UploadFileLike {
  uri: string;
  name: string;
  size?: number;
  mimeType?: string;
}

export interface PrepareUploadFileOptions {
  fileName: string;
  imageCompression: UploadImageCompression;
}

export const IMAGE_COMPRESSION_FAILED_ERROR = 'upload:image-compression-failed';

export type UploadFileNameValidationError =
  | 'empty'
  | 'invalid_chars'
  | 'basename_missing'
  | 'trailing_dot'
  | 'extension_missing'
  | 'duplicate';

const IMAGE_COMPRESSION_QUALITY: Record<Exclude<UploadImageCompression, 'original'>, number> = {
  high: 0.85,
  medium: 0.7,
  low: 0.5,
};

const IMAGE_SIZE_ESTIMATE_RATIO: Record<
  Exclude<UploadImageCompression, 'original'>,
  { jpeg: number; png: number; webp: number }
> = {
  high: { jpeg: 0.84, png: 0.96, webp: 0.82 },
  medium: { jpeg: 0.7, png: 0.9, webp: 0.66 },
  low: { jpeg: 0.56, png: 0.82, webp: 0.52 },
};

const compressionPreviewSizeCache = new Map<string, Promise<number | undefined>>();

const MIME_TYPE_EXTENSION_MAP: Record<string, string> = {
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
};

const COMPRESSIBLE_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

export function getFileExtension(fileName: string): string | null {
  const cleanName = fileName.split(/[?#]/, 1)[0];
  const lastDotIndex = cleanName.lastIndexOf('.');
  if (lastDotIndex <= 0 || lastDotIndex === cleanName.length - 1) {
    return null;
  }
  return cleanName.slice(lastDotIndex + 1);
}

export function getUploadFileNameParts(fileName: string): {
  baseName: string;
  extension: string | null;
} {
  const extension = getFileExtension(fileName);
  if (!extension) {
    return { baseName: fileName, extension: null };
  }

  return {
    baseName: fileName.slice(0, -(extension.length + 1)),
    extension,
  };
}

export function getFileNameFromUri(uri: string): string {
  const normalizedUri = decodeURIComponent(uri).split(/[?#]/, 1)[0];
  const segments = normalizedUri.split(/[\\/]/);
  return segments[segments.length - 1] || '';
}

function replaceFileExtension(fileName: string, nextExtension: string): string {
  const cleanExtension = nextExtension.replace(/^\.+/, '');
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex <= 0) {
    return `${fileName}.${cleanExtension}`;
  }
  return `${fileName.slice(0, lastDotIndex)}.${cleanExtension}`;
}

function getExtensionForMimeType(mimeType?: string): string | null {
  return mimeType ? MIME_TYPE_EXTENSION_MAP[mimeType] ?? null : null;
}

function getFallbackFileName(fileName: string): string {
  const extension = getFileExtension(fileName);
  if (!extension) return fileName || 'file';
  return fileName.slice(0, -(extension.length + 1)) || 'file';
}

export function sanitizeUploadFileName(name: string, fallback = 'file'): string {
  const trimmed = name.trim();
  const safe = trimmed.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-');
  return safe || fallback;
}

export function resolveInitialUploadFileName(options: {
  providedName?: string | null;
  mimeType?: string;
  uri?: string;
  fallbackName?: string;
}): string {
  const candidates = [options.providedName, options.uri ? getFileNameFromUri(options.uri) : null].filter(
    (value): value is string => !!value
  );

  for (const candidate of candidates) {
    const trimmedCandidate = candidate.trim();
    if (!trimmedCandidate) continue;

    const safeCandidate = sanitizeUploadFileName(trimmedCandidate, options.fallbackName ?? 'file');
    if (getFileExtension(safeCandidate)) {
      return safeCandidate;
    }
  }

  const fallbackSource = candidates[0] ?? options.fallbackName ?? 'file';
  return resolveUploadFileName(fallbackSource, {
    mimeType: options.mimeType,
    originalName: candidates[0] ?? options.fallbackName ?? 'file',
  });
}

export function validateUploadFileName(
  fileName: string,
  options: {
    mimeType?: string;
    originalName?: string;
  } = {}
): Exclude<UploadFileNameValidationError, 'duplicate'> | null {
  const trimmedName = fileName.trim();
  if (!trimmedName) {
    return 'empty';
  }

  if (/[<>:"/\\|?*\u0000-\u001F]/.test(trimmedName)) {
    return 'invalid_chars';
  }

  if (trimmedName.startsWith('.')) {
    return 'basename_missing';
  }

  if (trimmedName.endsWith('.')) {
    return 'trailing_dot';
  }

  const resolvedName = resolveUploadFileName(trimmedName, options);
  if (!getFileExtension(resolvedName)) {
    return 'extension_missing';
  }

  const lastDotIndex = resolvedName.lastIndexOf('.');
  if (lastDotIndex <= 0) {
    return 'basename_missing';
  }

  return null;
}

export function resolveUploadFileName(
  fileName: string,
  options: {
    mimeType?: string;
    originalName?: string;
  } = {}
): string {
  const fallbackName = getFallbackFileName(options.originalName ?? 'file');
  const sanitizedName = sanitizeUploadFileName(fileName, fallbackName);
  if (getFileExtension(sanitizedName)) {
    return sanitizedName;
  }
  const extension =
    getFileExtension(options.originalName ?? '') ?? getExtensionForMimeType(options.mimeType);
  return extension ? `${sanitizedName}.${extension}` : sanitizedName;
}

export function isCompressibleImageFile(file: Pick<UploadFileLike, 'name' | 'mimeType'>): boolean {
  const mimeType = file.mimeType || S3Service.guessMimeType(file.name);
  if (!mimeType.startsWith('image/')) {
    return false;
  }

  const extension = getFileExtension(file.name)?.toLowerCase();
  return !!extension && COMPRESSIBLE_IMAGE_EXTENSIONS.has(extension);
}

export function validateUploadFileNames(
  files: Array<Pick<UploadFileLike, 'name' | 'mimeType'> & { originalName?: string }>
): UploadFileNameValidationError | null {
  const seenNames = new Set<string>();

  for (const file of files) {
    const validationError = validateUploadFileName(file.name, {
      mimeType: file.mimeType,
      originalName: file.originalName ?? file.name,
    });
    if (validationError) {
      return validationError;
    }

    const resolvedName = resolveUploadFileName(file.name, {
      mimeType: file.mimeType,
      originalName: file.originalName ?? file.name,
    });

    if (seenNames.has(resolvedName)) {
      return 'duplicate';
    }
    seenNames.add(resolvedName);
  }

  return null;
}

function resolveImageSaveFormat(fileName: string): SaveFormat {
  const extension = getFileExtension(fileName)?.toLowerCase();
  if (extension === 'png') return SaveFormat.PNG;
  if (extension === 'webp') return SaveFormat.WEBP;
  return SaveFormat.JPEG;
}

export function estimateCompressedFileSize(
  file: Pick<UploadFileLike, 'name' | 'mimeType' | 'size'>,
  imageCompression: UploadImageCompression
): number | undefined {
  if (file.size == null || imageCompression === 'original' || !isCompressibleImageFile(file)) {
    return file.size;
  }

  const format = resolveImageSaveFormat(file.name);
  const ratioSet = IMAGE_SIZE_ESTIMATE_RATIO[imageCompression];
  const ratio =
    format === SaveFormat.PNG ? ratioSet.png : format === SaveFormat.WEBP ? ratioSet.webp : ratioSet.jpeg;

  const estimatedSize = Math.round(file.size * ratio);
  return Math.min(file.size, Math.max(estimatedSize, Math.round(file.size * 0.35)));
}

function resolveCompressedFileName(fileName: string, format: SaveFormat): string {
  const extension = getFileExtension(fileName)?.toLowerCase();

  if (format === SaveFormat.JPEG) {
    if (extension === 'jpg' || extension === 'jpeg') {
      return fileName;
    }
    return replaceFileExtension(fileName, 'jpg');
  }

  if (format === SaveFormat.PNG) {
    return extension === 'png' ? fileName : replaceFileExtension(fileName, 'png');
  }

  return extension === 'webp' ? fileName : replaceFileExtension(fileName, 'webp');
}

async function compressImageFile(
  file: UploadFileLike,
  resolvedName: string,
  imageCompression: Exclude<UploadImageCompression, 'original'>
): Promise<UploadFileLike> {
  const format = resolveImageSaveFormat(resolvedName);
  const compressed = await manipulateAsync(file.uri, [], {
    compress: IMAGE_COMPRESSION_QUALITY[imageCompression],
    format,
  });
  const compressedName = resolveCompressedFileName(resolvedName, format);
  const fileInfo = await FileSystem.getInfoAsync(compressed.uri);

  return {
    uri: compressed.uri,
    name: compressedName,
    size: fileInfo.exists && 'size' in fileInfo ? fileInfo.size : file.size,
    mimeType: S3Service.guessMimeType(compressedName),
  };
}

export async function getRealCompressedFileSizePreview(
  file: UploadFileLike,
  imageCompression: UploadImageCompression
): Promise<number | undefined> {
  if (imageCompression === 'original' || !isCompressibleImageFile(file)) {
    return file.size;
  }

  const cacheKey = `${file.uri}|${file.name}|${imageCompression}`;
  const cached = compressionPreviewSizeCache.get(cacheKey);
  if (cached) return cached;

  const previewPromise = (async () => {
    const resolvedName = resolveUploadFileName(file.name, {
      mimeType: file.mimeType,
      originalName: file.name,
    });
    const originalInfo =
      file.size != null ? { exists: true, size: file.size } : await FileSystem.getInfoAsync(file.uri);
    const originalSize =
      originalInfo.exists && 'size' in originalInfo ? originalInfo.size : file.size;

    let previewFile: UploadFileLike | null = null;
    try {
      previewFile = await compressImageFile(file, resolvedName, imageCompression);
      return previewFile.size ?? originalSize;
    } catch {
      return estimateCompressedFileSize(file, imageCompression);
    } finally {
      if (previewFile && previewFile.uri !== file.uri) {
        await FileSystem.deleteAsync(previewFile.uri, { idempotent: true }).catch(() => {});
      }
    }
  })();

  compressionPreviewSizeCache.set(cacheKey, previewPromise);
  return previewPromise;
}

export async function prepareUploadFile(
  file: UploadFileLike,
  options: PrepareUploadFileOptions
): Promise<UploadFileLike> {
  const resolvedName = resolveUploadFileName(options.fileName, {
    mimeType: file.mimeType,
    originalName: file.name,
  });
  const resolvedMimeType = file.mimeType || S3Service.guessMimeType(resolvedName);

  if (options.imageCompression === 'original' || !isCompressibleImageFile(file)) {
    return {
      ...file,
      name: resolvedName,
      mimeType: resolvedMimeType,
    };
  }

  try {
    const compressedFile = await compressImageFile(file, resolvedName, options.imageCompression);
    const originalInfo =
      file.size != null ? { exists: true, size: file.size } : await FileSystem.getInfoAsync(file.uri);
    const compressedSize = compressedFile.size;
    const originalSize = originalInfo.exists && 'size' in originalInfo ? originalInfo.size : file.size;

    if (
      typeof compressedSize === 'number' &&
      typeof originalSize === 'number' &&
      compressedSize >= originalSize
    ) {
      return {
        ...file,
        name: resolvedName,
        mimeType: resolvedMimeType,
        size: originalSize,
      };
    }

    return {
      uri: compressedFile.uri,
      name: compressedFile.name,
      size: compressedSize,
      mimeType: compressedFile.mimeType,
    };
  } catch {
    throw new Error(IMAGE_COMPRESSION_FAILED_ERROR);
  }
}
