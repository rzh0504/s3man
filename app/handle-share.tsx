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
  ChevronRightIcon,
  FolderIcon,
  FileIcon,
  ImageIcon,
  FileVideoIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  Loader2Icon,
} from 'lucide-react-native';
import * as React from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { getSharedPayloads } from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

// ── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getFileName(uri: string): string {
  const decoded = decodeURIComponent(uri);
  const segments = decoded.split('/');
  return segments[segments.length - 1] || 'shared-file';
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

// ── Screen ─────────────────────────────────────────────────────────────────

export default function HandleShareScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
        Alert.alert('Error', 'Failed to load buckets');
      })
      .finally(() => setBucketsLoading(false));
  }, [selectedConnectionId]);

  // Get file sizes
  React.useEffect(() => {
    sharedFiles.forEach((f, i) => {
      if (f.size != null) return;
      FileSystem.getInfoAsync(f.uri)
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

    const results = [...fileStates];

    for (let i = 0; i < sharedFiles.length; i++) {
      const file = sharedFiles[i];
      const key = file.name;
      const mimeType = file.mimeType || S3Service.guessMimeType(file.name);
      const fileSize = file.size ?? 0;

      // Update state to uploading
      results[i] = { ...results[i], status: 'uploading', progress: 5 };
      setFileStates([...results]);

      // Add transfer task for monitoring
      const taskId = generateId();
      const task: TransferTask = {
        id: taskId,
        fileName: file.name,
        type: 'upload',
        status: 'active',
        progress: 0,
        totalBytes: fileSize,
        transferredBytes: 0,
        bucket: selectedBucket,
        key,
        connectionId: selectedConnectionId,
        localPath: file.uri,
        startedAt: new Date().toISOString(),
      };
      addTask(task);

      try {
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
        const progressTimer = setInterval(() => {
          if (currentProgress < 90) {
            currentProgress = Math.min(90, currentProgress + increment);
            results[i] = { ...results[i], progress: Math.round(currentProgress) };
            setFileStates([...results]);
            updateTask(taskId, {
              progress: Math.round(currentProgress),
              transferredBytes: Math.round((currentProgress / 100) * fileSize),
            });
          }
        }, interval);

        await FileSystem.uploadAsync(presignedUrl, file.uri, {
          httpMethod: 'PUT',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: { 'Content-Type': mimeType },
        });

        clearInterval(progressTimer);
        results[i] = { ...results[i], status: 'done', progress: 100 };
        setFileStates([...results]);
        updateTask(taskId, {
          progress: 100,
          transferredBytes: fileSize,
          status: 'completed',
          completedAt: new Date().toISOString(),
        });
      } catch (error: any) {
        console.error('Share upload error:', error);
        results[i] = { ...results[i], status: 'error', error: error.message || 'Upload failed' };
        setFileStates([...results]);
        updateTask(taskId, {
          status: 'failed',
          error: error.message || 'Upload failed',
        });
      }
    }

    setIsUploading(false);
    setUploadDone(true);
  }, [selectedConnectionId, selectedBucket, sharedFiles, fileStates, addTask, updateTask]);

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  const selectedConnection = connectedConns.find((c) => c.id === selectedConnectionId);

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
          <Text className="text-foreground mb-2 text-lg font-semibold">No files to upload</Text>
          <Text className="text-muted-foreground mb-6 text-center text-sm">
            No compatible files were shared with S3Man.
          </Text>
          <Button onPress={handleClose}>
            <Text className="text-primary-foreground">Go Back</Text>
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
          <Text className="text-foreground text-lg font-semibold">Upload Shared Files</Text>
          <View className="size-8" />
        </View>

        <Separator />

        <ScrollView className="flex-1" contentContainerClassName="pb-8">
          {/* Shared files list */}
          <View className="px-4 pt-4 pb-2">
            <Text className="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
              {sharedFiles.length} file{sharedFiles.length > 1 ? 's' : ''} to upload
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
              Destination Connection
            </Text>
            {connectedConns.length === 0 ? (
              <View className="rounded-lg border border-dashed border-yellow-500/40 bg-yellow-500/10 p-4">
                <Text className="text-foreground text-center text-sm">
                  No connected providers. Please configure a connection first.
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
                  Destination Bucket
                </Text>
                {bucketsLoading ? (
                  <ActivityIndicator className="py-4" />
                ) : buckets.length === 0 ? (
                  <Text className="text-muted-foreground py-4 text-center text-sm">
                    No buckets found
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
          {uploadDone ? (
            <Button onPress={handleClose} className="flex-row items-center justify-center gap-2">
              <Icon as={CheckCircle2Icon} className="text-primary-foreground size-5" />
              <Text className="text-primary-foreground font-semibold">Done</Text>
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
                {isUploading ? 'Uploading...' : `Upload to ${selectedBucket ?? 'Select a bucket'}`}
              </Text>
            </Button>
          )}
        </View>
      </View>
    </>
  );
}
