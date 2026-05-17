import * as FileSystem from 'expo-file-system/legacy';
import * as S3Service from '@/lib/s3-service';
import type { S3Object, TransferTask } from '@/lib/types';
import { prepareUploadFile, type UploadFileLike, type UploadImageCompression } from '@/lib/upload-preprocess';
import { registerTransferController, unregisterTransferController } from '@/lib/transfer-controller';

const MULTIPART_UPLOAD_THRESHOLD_BYTES = 32 * 1024 * 1024;
const MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024;
const MULTIPART_MAX_PART_RETRIES = 3;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

export interface RunUploadTaskOptions {
  connectionId: string;
  bucket: string;
  key: string;
  keyPrefix?: string;
  inputFile: UploadFileLike;
  targetFileName: string;
  imageCompression: UploadImageCompression;
  convertToWebp?: boolean;
  addTask: (task: TransferTask) => void;
  updateTask: (id: string, updates: Partial<TransferTask>) => void;
  mapError?: (error: unknown) => string;
  initialProgress?: number;
  onPreparedFile?: (file: UploadFileLike) => void | Promise<void>;
  onProgress?: (progress: number) => void;
}

export interface RunUploadTaskResult {
  success: boolean;
  file?: UploadFileLike;
  object?: S3Object;
  error?: string;
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === lowerName);
  return entry?.[1];
}

async function ensureMultipartTempDir(): Promise<string> {
  if (!FileSystem.cacheDirectory) {
    throw new Error('Cache directory is unavailable');
  }
  const dir = `${FileSystem.cacheDirectory}multipart-upload/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

async function createPartFile(sourceUri: string, partUri: string, position: number, length: number): Promise<void> {
  const chunk = await FileSystem.readAsStringAsync(sourceUri, {
    encoding: FileSystem.EncodingType.Base64,
    position,
    length,
  });
  await FileSystem.writeAsStringAsync(partUri, chunk, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

export async function runUploadTask({
  connectionId,
  bucket,
  key,
  keyPrefix,
  inputFile,
  targetFileName,
  imageCompression,
  convertToWebp,
  addTask,
  updateTask,
  mapError,
  initialProgress = 5,
  onPreparedFile,
  onProgress,
}: RunUploadTaskOptions): Promise<RunUploadTaskResult> {
  let taskId: string | null = null;
  let wasCancelled = false;
  let uploadId: string | null = null;
  let uploadKeyForCleanup = key;
  let activeNetworkTask: { cancelAsync: () => Promise<void> } | null = null;

  try {
    const uploadFile = await prepareUploadFile(inputFile, {
      fileName: targetFileName,
      imageCompression,
      convertToWebp,
    });
    await onPreparedFile?.(uploadFile);

    const uploadKey = keyPrefix != null ? keyPrefix + uploadFile.name : key;
    uploadKeyForCleanup = uploadKey;
    const mimeType = uploadFile.mimeType || S3Service.guessMimeType(uploadFile.name);
    const fileSize = uploadFile.size ?? 0;
    const activeTaskId = generateId();
    taskId = activeTaskId;

    addTask({
      id: activeTaskId,
      fileName: uploadFile.name,
      type: 'upload',
      status: 'active',
      progress: 0,
      totalBytes: fileSize,
      transferredBytes: 0,
      bucket,
      key: uploadKey,
      connectionId,
      localPath: uploadFile.uri,
      startedAt: new Date().toISOString(),
    });

    registerTransferController(activeTaskId, {
      cancel: async () => {
        wasCancelled = true;
        await activeNetworkTask?.cancelAsync().catch(() => {});
        if (uploadId) {
          await S3Service.abortMultipartUpload(connectionId, bucket, uploadKey, uploadId).catch(() => {});
        }
      },
    });

    onProgress?.(initialProgress);
    updateTask(activeTaskId, { progress: initialProgress });

    if (fileSize >= MULTIPART_UPLOAD_THRESHOLD_BYTES && FileSystem.cacheDirectory) {
      uploadId = await S3Service.createMultipartUpload(connectionId, bucket, uploadKey, mimeType);
      const tempDir = await ensureMultipartTempDir();
      const partCount = Math.ceil(fileSize / MULTIPART_PART_SIZE_BYTES);
      const completedParts: S3Service.CompletedUploadPart[] = [];
      let completedBytes = 0;

      for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
        if (wasCancelled) throw new Error('Cancelled');
        const partNumber = partIndex + 1;
        const position = partIndex * MULTIPART_PART_SIZE_BYTES;
        const length = Math.min(MULTIPART_PART_SIZE_BYTES, fileSize - position);
        const partUri = `${tempDir}${activeTaskId}-part-${partNumber}`;
        await createPartFile(uploadFile.uri, partUri, position, length);

        try {
          let lastError: unknown;
          for (let attempt = 1; attempt <= MULTIPART_MAX_PART_RETRIES; attempt += 1) {
            if (wasCancelled) throw new Error('Cancelled');
            try {
              const partUrl = await S3Service.getPresignedUploadPartUrl(
                connectionId,
                bucket,
                uploadKey,
                uploadId,
                partNumber
              );
              const uploadTask = FileSystem.createUploadTask(partUrl, partUri, {
                httpMethod: 'PUT',
                uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
              }, (data) => {
                const transferredBytes = Math.min(fileSize, completedBytes + data.totalBytesSent);
                const progress = Math.min(99, Math.round((transferredBytes / fileSize) * 100));
                onProgress?.(progress);
                updateTask(activeTaskId, { progress, transferredBytes });
              });
              activeNetworkTask = uploadTask;
              const result = await uploadTask.uploadAsync();
              if (!result || wasCancelled) throw new Error('Cancelled');
              if (result.status < 200 || result.status >= 300) {
                throw new Error(`Upload part ${partNumber} failed with HTTP ${result.status}`);
              }
              const eTag = getHeader(result.headers, 'etag');
              if (!eTag) {
                throw new Error(`Upload part ${partNumber} did not return an ETag`);
              }
              completedParts.push({ partNumber, eTag });
              completedBytes += length;
              break;
            } catch (error) {
              lastError = error;
              if (attempt === MULTIPART_MAX_PART_RETRIES || wasCancelled) throw error;
            }
          }
          if (lastError && completedParts.length < partNumber) throw lastError;
        } finally {
          activeNetworkTask = null;
          await FileSystem.deleteAsync(partUri, { idempotent: true }).catch(() => {});
        }
      }

      if (wasCancelled) throw new Error('Cancelled');
      await S3Service.completeMultipartUpload(connectionId, bucket, uploadKey, uploadId, completedParts);
      uploadId = null;
    } else {
      const presignedUrl = await S3Service.getPresignedUploadUrl(connectionId, bucket, uploadKey, mimeType);

      const uploadTask = FileSystem.createUploadTask(presignedUrl, uploadFile.uri, {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { 'Content-Type': mimeType },
      }, (data) => {
        const expectedBytes = data.totalBytesExpectedToSend > 0 ? data.totalBytesExpectedToSend : fileSize;
        const progress = expectedBytes > 0
          ? Math.min(99, Math.round((data.totalBytesSent / expectedBytes) * 100))
          : initialProgress;
        onProgress?.(progress);
        updateTask(activeTaskId, {
          progress,
          totalBytes: expectedBytes,
          transferredBytes: data.totalBytesSent,
        });
      });

      activeNetworkTask = uploadTask;
      const uploadResult = await uploadTask.uploadAsync();
      activeNetworkTask = null;
      if (!uploadResult || wasCancelled) {
        throw new Error('Cancelled');
      }
    }

    unregisterTransferController(activeTaskId);
    onProgress?.(100);
    updateTask(activeTaskId, {
      progress: 100,
      transferredBytes: fileSize,
      status: 'completed',
      completedAt: new Date().toISOString(),
    });

    return {
      success: true,
      file: uploadFile,
      object: {
        key: uploadKey,
        name: uploadFile.name,
        size: fileSize,
        lastModified: new Date().toISOString(),
        isFolder: false,
      },
    };
  } catch (error) {
    if (taskId) unregisterTransferController(taskId);
    if (uploadId) {
      await S3Service.abortMultipartUpload(connectionId, bucket, uploadKeyForCleanup, uploadId).catch(() => {});
    }
    const errorMessage = wasCancelled
      ? 'Cancelled'
      : mapError
        ? mapError(error)
        : error instanceof Error ? error.message : 'Upload failed';
    if (taskId) {
      updateTask(taskId, {
        status: 'failed',
        error: errorMessage,
      });
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}
