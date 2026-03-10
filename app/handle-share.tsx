import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Separator } from '@/components/ui/separator';
import { ProviderIcon } from '@/components/provider-icons';
import { useConnectionStore } from '@/lib/stores/connection-store';
import { useTransferStore } from '@/lib/stores/transfer-store';
import * as S3Service from '@/lib/s3-service';
import { formatBytes, getProvider } from '@/lib/constants';
import type { BucketInfo, TransferTask } from '@/lib/types';
import {
  UploadCloudIcon,
  XIcon,
  FolderIcon,
  FileIcon,
  ImageIcon,
  FileVideoIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
} from 'lucide-react-native';
import * as React from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { getSharedPayloads } from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useT } from '@/lib/i18n';

// ── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getFileName(uri: string): string {
  const decoded = decodeURIComponent(uri);
  const segments = decoded.split('/');
  return segments[segments.length - 1] || 'shared-file';
}

function hasUriScheme(uri: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(uri);
}

function normalizeLocalUri(uri: string): string {
  if (!uri) return uri;
  return hasUriScheme(uri) ? uri : `file://${uri}`;
}

function sanitizeFileName(name: string): string {
  const trimmed = name.trim();
  const safe = trimmed.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-');
  return safe || 'shared-file';
}

function getExtensionForMimeType(mimeType?: string): string | null {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'application/pdf': 'pdf',
  };
  return mimeType ? map[mimeType] ?? null : null;
}

function ensureFileNameExtension(name: string, mimeType?: string): string {
  if (name.includes('.')) return name;
  const ext = getExtensionForMimeType(mimeType);
  return ext ? `${name}.${ext}` : name;
}

function getContentIcon(type?: string) {
  switch (type) {
    case 'image':
      return ImageIcon;
    case 'video':
      return FileVideoIcon;
    default:
      return FileIcon;
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

interface SharedFile {
  uri: string;
  name: string;
  size?: number;
  mimeType?: string;
  shareType?: string;
}

type UploadStatus = 'idle' | 'uploading' | 'done' | 'error';

interface FileUploadState {
  file: SharedFile;
  status: UploadStatus;
  progress: number;
  error?: string;
}

interface UploadSummary {
  success: number;
  failed: number;
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function HandleShareScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const connections = useConnectionStore((s) => s.connections);
  const connectedConns = connections.filter((c) => c.status === 'connected');
  const addTask = useTransferStore((s) => s.addTask);
  const updateTask = useTransferStore((s) => s.updateTask);

  const [sharedFiles, setSharedFiles] = React.useState<SharedFile[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Destination selection
  const [selectedConnectionId, setSelectedConnectionId] = React.useState<string | null>(null);
  const [buckets, setBuckets] = React.useState<BucketInfo[]>([]);
  const [bucketsLoading, setBucketsLoading] = React.useState(false);
  const [selectedBucket, setSelectedBucket] = React.useState<string | null>(null);

  // Upload state
  const [fileStates, setFileStates] = React.useState<FileUploadState[]>([]);
  const [isUploading, setIsUploading] = React.useState(false);
  const [uploadDone, setUploadDone] = React.useState(false);
  const [uploadSummary, setUploadSummary] = React.useState<UploadSummary | null>(null);

  const getReadableUploadError = React.useCallback(
    (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : t('share.uploadFailed');

      if (/doesn't exist|no such file|enoent|failed to copy/i.test(message)) {
        return t('share.prepareFailed');
      }

      return message || t('share.uploadFailed');
    },
    [t]
  );

  const syncPreparedFile = React.useCallback((index: number, file: SharedFile) => {
    setSharedFiles((prev) => {
      if (!prev[index]) return prev;
      const next = [...prev];
      next[index] = file;
      return next;
    });

    setFileStates((prev) => {
      if (!prev[index]) return prev;
      const next = [...prev];
      next[index] = { ...next[index], file };
      return next;
    });
  }, []);

  const resolveSharedFileForUpload = React.useCallback(
    async (file: SharedFile, index: number): Promise<SharedFile> => {
      const directCandidates = Array.from(
        new Set([file.uri, normalizeLocalUri(file.uri)].filter(Boolean))
      );

      for (const candidate of directCandidates) {
        try {
          const info = await FileSystem.getInfoAsync(candidate);
          if (info.exists && candidate.startsWith('file://')) {
            return {
              ...file,
              uri: candidate,
              size: 'size' in info ? info.size : file.size,
            };
          }
        } catch {
          // Try the next candidate or fallback copy.
        }
      }

      if (!FileSystem.cacheDirectory) {
        throw new Error(t('share.prepareFailed'));
      }

      const cacheDir = `${FileSystem.cacheDirectory}shared-uploads/`;
      await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });

      const fileName = ensureFileNameExtension(sanitizeFileName(file.name), file.mimeType);
      const cacheUri = `${cacheDir}${Date.now()}-${index}-${fileName}`;
      let copyError: unknown;

      for (const candidate of directCandidates) {
        try {
          await FileSystem.copyAsync({ from: candidate, to: cacheUri });
          const copiedInfo = await FileSystem.getInfoAsync(cacheUri);
          return {
            ...file,
            uri: cacheUri,
            size: copiedInfo.exists && 'size' in copiedInfo ? copiedInfo.size : file.size,
          };
        } catch (error) {
          copyError = error;
        }
      }

      throw copyError ?? new Error(t('share.prepareFailed'));
    },
    [t]
  );

  // ── Load shared payloads ─────────────────────────────────────────────
  React.useEffect(() => {
    try {
      const payloads = getSharedPayloads();
      const files: SharedFile[] = payloads
        .filter((p) => p.value && p.shareType !== 'text' && p.shareType !== 'url')
        .map((p) => ({
          uri: p.value!,
          name: getFileName(p.value!),
          mimeType: p.mimeType,
          shareType: p.shareType,
        }));
      setSharedFiles(files);
      setFileStates(files.map((f) => ({ file: f, status: 'idle', progress: 0 })));
    } catch (e) {
      console.error('Failed to get shared payloads:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-select first connected connection
  React.useEffect(() => {
    if (connectedConns.length === 1 && !selectedConnectionId) {
      setSelectedConnectionId(connectedConns[0].id);
    }
  }, [connectedConns, selectedConnectionId]);

  // Load buckets when connection selected
  React.useEffect(() => {
    if (!selectedConnectionId) return;
    setBucketsLoading(true);
    setBuckets([]);
    setSelectedBucket(null);

    S3Service.listBuckets(selectedConnectionId)
      .then((b) => setBuckets(b))
      .catch((e) => {
        console.error('Failed to list buckets:', e);
        Alert.alert(t('share.error'), t('share.loadBucketsFailed'));
      })
      .finally(() => setBucketsLoading(false));
  }, [selectedConnectionId]);

  // Get file sizes
  React.useEffect(() => {
    sharedFiles.forEach((f, i) => {
      if (f.size != null) return;
      FileSystem.getInfoAsync(normalizeLocalUri(f.uri))
        .then((info) => {
          if (info.exists && 'size' in info) {
            setSharedFiles((prev) => {
              const next = [...prev];
              next[i] = { ...next[i], size: info.size };
              return next;
            });
          }
        })
        .catch(() => {});
    });
  }, [sharedFiles.length]);

  // ── Upload handler ───────────────────────────────────────────────────
  const handleUpload = React.useCallback(async () => {
    if (!selectedConnectionId || !selectedBucket || sharedFiles.length === 0) return;
    setIsUploading(true);
    setUploadDone(false);
    setUploadSummary(null);

    const results = [...fileStates];
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < sharedFiles.length; i++) {
      // Update state to uploading
      results[i] = { ...results[i], status: 'uploading', progress: 3, error: undefined };
      setFileStates([...results]);

      let progressTimer: ReturnType<typeof setInterval> | null = null;
      let taskId: string | null = null;

      try {
        const preparedFile = await resolveSharedFileForUpload(sharedFiles[i], i);
        syncPreparedFile(i, preparedFile);

        const key = preparedFile.name;
        const mimeType = preparedFile.mimeType || S3Service.guessMimeType(preparedFile.name);
        const fileSize = preparedFile.size ?? 0;

        taskId = generateId();
        const task: TransferTask = {
          id: taskId,
          fileName: preparedFile.name,
          type: 'upload',
          status: 'active',
          progress: 0,
          totalBytes: fileSize,
          transferredBytes: 0,
          bucket: selectedBucket,
          key,
          connectionId: selectedConnectionId,
          localPath: preparedFile.uri,
          startedAt: new Date().toISOString(),
        };
        addTask(task);

        const presignedUrl = await S3Service.getPresignedUploadUrl(
          selectedConnectionId,
          selectedBucket,
          key,
          mimeType
        );

        results[i] = { ...results[i], progress: 15 };
        setFileStates([...results]);

        // Simulated progress
        let currentProgress = 15;
        const increment = fileSize > 10_000_000 ? 1.5 : fileSize > 1_000_000 ? 4 : 10;
        const interval = fileSize > 10_000_000 ? 800 : 500;
        progressTimer = setInterval(() => {
          if (currentProgress < 90) {
            currentProgress = Math.min(90, currentProgress + increment);
            results[i] = { ...results[i], progress: Math.round(currentProgress) };
            setFileStates([...results]);
            updateTask(task.id, {
              progress: Math.round(currentProgress),
              transferredBytes: Math.round((currentProgress / 100) * fileSize),
            });
          }
        }, interval);

        await FileSystem.uploadAsync(presignedUrl, preparedFile.uri, {
          httpMethod: 'PUT',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: { 'Content-Type': mimeType },
        });

        results[i] = { ...results[i], status: 'done', progress: 100 };
        setFileStates([...results]);
        updateTask(task.id, {
          progress: 100,
          transferredBytes: fileSize,
          status: 'completed',
          completedAt: new Date().toISOString(),
        });
        successCount += 1;
      } catch (error: any) {
        console.error('Share upload error:', error);
        const errorMessage = getReadableUploadError(error);
        results[i] = { ...results[i], status: 'error', error: errorMessage };
        setFileStates([...results]);
        if (taskId) {
          updateTask(taskId, {
            status: 'failed',
            error: errorMessage,
          });
        }
        failedCount += 1;
      } finally {
        if (progressTimer) {
          clearInterval(progressTimer);
        }
      }
    }

    setIsUploading(false);
    setUploadDone(true);
    setUploadSummary({
      success: successCount,
      failed: failedCount,
    });
  }, [
    selectedConnectionId,
    selectedBucket,
    sharedFiles,
    fileStates,
    addTask,
    updateTask,
    getReadableUploadError,
    resolveSharedFileForUpload,
    syncPreparedFile,
  ]);

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  const hasUploadFailures = (uploadSummary?.failed ?? 0) > 0;

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View className="bg-background flex-1 items-center justify-center">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (sharedFiles.length === 0) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View
          className="bg-background flex-1 items-center justify-center px-8"
          style={{ paddingTop: insets.top }}>
          <Icon as={FileIcon} className="text-muted-foreground mb-4 size-16" />
          <Text className="text-foreground mb-2 text-lg font-semibold">{t('share.noFiles')}</Text>
          <Text className="text-muted-foreground mb-6 text-center text-sm">
            {t('share.noFilesDesc')}
          </Text>
          <Button onPress={handleClose}>
            <Text className="text-primary-foreground">{t('share.goBack')}</Text>
          </Button>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3">
          <Pressable onPress={handleClose} className="rounded-md p-1">
            <Icon as={XIcon} className="text-foreground size-6" />
          </Pressable>
          <Text className="text-foreground text-lg font-semibold">{t('share.uploadTitle')}</Text>
          <View className="size-8" />
        </View>

        <Separator />

        <ScrollView className="flex-1" contentContainerClassName="pb-8">
          {/* Shared files list */}
          <View className="px-4 pt-4 pb-2">
            <Text className="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
              {t('share.fileCount', { count: sharedFiles.length })}
            </Text>
            {sharedFiles.map((file, i) => {
              const state = fileStates[i];
              const ContentIcon = getContentIcon(file.shareType);
              return (
                <View key={i} className="mb-2 flex-row items-center gap-3 rounded-lg py-2">
                  <Icon as={ContentIcon} className="text-muted-foreground size-5" />
                  <View className="flex-1">
                    <Text className="text-foreground text-sm" numberOfLines={1}>
                      {file.name}
                    </Text>
                    {file.size != null && (
                      <Text className="text-muted-foreground text-xs">
                        {formatBytes(file.size)}
                      </Text>
                    )}
                    {state?.status === 'error' && !!state.error && (
                      <Text className="mt-1 text-xs text-red-500" numberOfLines={3}>
                        {state.error}
                      </Text>
                    )}
                  </View>
                  {state?.status === 'uploading' && (
                    <Text className="text-primary text-xs font-medium">{state.progress}%</Text>
                  )}
                  {state?.status === 'done' && (
                    <Icon as={CheckCircle2Icon} className="text-primary size-5" />
                  )}
                  {state?.status === 'error' && (
                    <Icon as={AlertCircleIcon} className="size-5 text-red-500" />
                  )}
                </View>
              );
            })}
          </View>

          <Separator className="mx-4" />

          {/* Connection selector */}
          <View className="px-4 pt-4 pb-2">
            <Text className="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
              {t('share.destConnection')}
            </Text>
            {connectedConns.length === 0 ? (
              <View className="rounded-lg border border-dashed border-yellow-500/40 bg-yellow-500/10 p-4">
                <Text className="text-foreground text-center text-sm">
                  {t('share.noProviders')}
                </Text>
              </View>
            ) : (
              connectedConns.map((conn) => {
                const isSelected = conn.id === selectedConnectionId;
                const provInfo = getProvider(conn.config.provider);
                return (
                  <Pressable
                    key={conn.id}
                    onPress={() => setSelectedConnectionId(conn.id)}
                    className={`mb-2 flex-row items-center gap-3 rounded-lg border p-3 ${
                      isSelected ? 'border-primary bg-primary/5' : 'border-border'
                    }`}>
                    <ProviderIcon provider={conn.config.provider} size={20} />
                    <View className="flex-1">
                      <Text className="text-foreground text-sm font-medium">
                        {conn.displayName}
                      </Text>
                      <Text className="text-muted-foreground text-xs">{provInfo.label}</Text>
                    </View>
                    {isSelected && (
                      <View className="bg-primary size-5 items-center justify-center rounded-full">
                        <View className="size-2 rounded-full bg-white" />
                      </View>
                    )}
                  </Pressable>
                );
              })
            )}
          </View>

          {/* Bucket selector */}
          {selectedConnectionId && (
            <>
              <Separator className="mx-4" />
              <View className="px-4 pt-4 pb-2">
                <Text className="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
                  {t('share.destBucket')}
                </Text>
                {bucketsLoading ? (
                  <ActivityIndicator className="py-4" />
                ) : buckets.length === 0 ? (
                  <Text className="text-muted-foreground py-4 text-center text-sm">
                    {t('share.noBuckets')}
                  </Text>
                ) : (
                  buckets.map((bucket) => {
                    const isSelected = bucket.name === selectedBucket;
                    return (
                      <Pressable
                        key={bucket.name}
                        onPress={() => setSelectedBucket(bucket.name)}
                        className={`mb-2 flex-row items-center gap-3 rounded-lg border p-3 ${
                          isSelected ? 'border-primary bg-primary/5' : 'border-border'
                        }`}>
                        <Icon as={FolderIcon} className="text-muted-foreground size-5" />
                        <Text className="text-foreground flex-1 text-sm font-medium">
                          {bucket.name}
                        </Text>
                        {isSelected && (
                          <View className="bg-primary size-5 items-center justify-center rounded-full">
                            <View className="size-2 rounded-full bg-white" />
                          </View>
                        )}
                      </Pressable>
                    );
                  })
                )}
              </View>
            </>
          )}
        </ScrollView>

        {/* Bottom action */}
        <View
          className="border-border border-t px-4 py-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
          {uploadSummary && (
            <View
              className={`mb-3 rounded-lg border px-3 py-2 ${
                hasUploadFailures
                  ? 'border-red-500/30 bg-red-500/10'
                  : 'border-green-500/30 bg-green-500/10'
              }`}>
              <Text
                className={`text-sm ${
                  hasUploadFailures ? 'text-red-600' : 'text-green-600'
                }`}>
                {uploadSummary.failed === 0
                  ? t('share.uploadSuccessSummary', { count: uploadSummary.success })
                  : uploadSummary.success > 0
                    ? t('share.uploadPartialSummary', {
                        success: uploadSummary.success,
                        failed: uploadSummary.failed,
                      })
                    : t('share.uploadAllFailedSummary', { count: uploadSummary.failed })}
              </Text>
            </View>
          )}

          {uploadDone ? (
            <Button onPress={handleClose} className="flex-row items-center justify-center gap-2">
              <Icon
                as={hasUploadFailures ? AlertCircleIcon : CheckCircle2Icon}
                className="text-primary-foreground size-5"
              />
              <Text className="text-primary-foreground font-semibold">
                {hasUploadFailures ? t('share.goBack') : t('share.done')}
              </Text>
            </Button>
          ) : (
            <Button
              onPress={handleUpload}
              disabled={!selectedBucket || isUploading || connectedConns.length === 0}
              className="flex-row items-center justify-center gap-2">
              {isUploading ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Icon as={UploadCloudIcon} className="text-primary-foreground size-5" />
              )}
              <Text className="text-primary-foreground font-semibold">
                {isUploading
                  ? t('share.uploading')
                  : selectedBucket
                    ? t('share.uploadTo', { bucket: selectedBucket })
                    : t('share.selectBucket')}
              </Text>
            </Button>
          )}
        </View>
      </View>
    </>
  );
}
