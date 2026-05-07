import * as FileSystem from 'expo-file-system/legacy';
import * as S3Service from '@/lib/s3-service';
import type { S3Object, TransferTask } from '@/lib/types';
import { prepareUploadFile, type UploadFileLike, type UploadImageCompression } from '@/lib/upload-preprocess';

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
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  let taskId: string | null = null;

  try {
    const uploadFile = await prepareUploadFile(inputFile, {
      fileName: targetFileName,
      imageCompression,
      convertToWebp,
    });
    await onPreparedFile?.(uploadFile);

    const uploadKey = keyPrefix != null ? keyPrefix + uploadFile.name : key;
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

    const presignedUrl = await S3Service.getPresignedUploadUrl(connectionId, bucket, uploadKey, mimeType);

    let currentProgress = initialProgress;
    onProgress?.(currentProgress);
    updateTask(activeTaskId, { progress: currentProgress });

    const increment = fileSize > 10_000_000 ? 1.5 : fileSize > 1_000_000 ? 4 : 10;
    const interval = fileSize > 10_000_000 ? 800 : 500;
    progressTimer = setInterval(() => {
      if (currentProgress < 90) {
        currentProgress = Math.min(90, currentProgress + increment);
      } else if (currentProgress < 99) {
        currentProgress = Math.min(99, currentProgress + 0.5);
      }

      const roundedProgress = Math.round(currentProgress);
      onProgress?.(roundedProgress);
      updateTask(activeTaskId, {
        progress: roundedProgress,
        transferredBytes: Math.round((roundedProgress / 100) * fileSize),
      });
    }, interval);

    await FileSystem.uploadAsync(presignedUrl, uploadFile.uri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': mimeType },
    });

    if (progressTimer) clearInterval(progressTimer);
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
    if (progressTimer) clearInterval(progressTimer);
    const errorMessage = mapError ? mapError(error) : error instanceof Error ? error.message : 'Upload failed';
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
