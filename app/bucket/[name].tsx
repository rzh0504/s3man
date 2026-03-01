import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ObjectItem } from '@/components/object-item';
import { Breadcrumb } from '@/components/breadcrumb';
import { EmptyState } from '@/components/empty-state';
import { FilePreview } from '@/components/file-preview';
import { useObjectStore } from '@/lib/stores/object-store';
import { useTransferStore } from '@/lib/stores/transfer-store';
import * as S3Service from '@/lib/s3-service';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes } from '@/lib/constants';
import {
  DownloadIcon,
  UploadIcon,
  FolderIcon,
  ChevronLeftIcon,
  EyeIcon,
  DatabaseIcon,
  CheckCircleIcon,
  XIcon,
  Trash2Icon,
  PlusIcon,
} from 'lucide-react-native';
import * as React from 'react';
import { View, FlatList, RefreshControl, Pressable, Platform, Share } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { S3Object, TransferTask } from '@/lib/types';
import { Progress } from '@/components/ui/progress';
import { invalidateBucketCache } from '@/lib/cache';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/** Skeleton placeholder for the object list while initial data loads */
function ObjectListSkeleton() {
  return (
    <View className="px-4 py-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <View key={i} className="flex-row items-center gap-3 py-3">
          <Skeleton className="size-6 rounded" />
          <View className="flex-1 gap-1.5">
            <Skeleton className="h-4 w-3/4 rounded" />
            <Skeleton className="h-3 w-1/3 rounded" />
          </View>
          <Skeleton className="h-3 w-12 rounded" />
        </View>
      ))}
    </View>
  );
}

export default function ObjectBrowserScreen() {
  const { name: bucketName, connectionId } = useLocalSearchParams<{
    name: string;
    connectionId: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    currentPrefix,
    objects,
    selectedKeys,
    isLoading,
    setCurrentBucket,
    setCurrentPrefix,
    setObjects,
    setLoading,
    toggleSelection,
    clearSelection,
    breadcrumbs,
  } = useObjectStore();

  const addTask = useTransferStore((s) => s.addTask);
  const updateTask = useTransferStore((s) => s.updateTask);
  const allTasks = useTransferStore((s) => s.tasks);

  // Upload batch tracking: total files picked and how many completed
  const [uploadBatch, setUploadBatch] = React.useState<{ total: number; completed: number } | null>(
    null
  );

  // Active uploads for the current bucket — drives the progress overlay
  const activeUploads = React.useMemo(
    () =>
      allTasks.filter(
        (t) =>
          t.type === 'upload' &&
          t.bucket === bucketName &&
          (t.status === 'active' || t.status === 'pending')
      ),
    [allTasks, bucketName]
  );

  // Aggregate upload progress
  const uploadProgress = React.useMemo(() => {
    if (!uploadBatch || uploadBatch.total === 0) return null;
    // Still has active tasks OR batch just started
    if (activeUploads.length === 0 && uploadBatch.completed >= uploadBatch.total) {
      return null; // All done, hide overlay
    }
    const totalBytes = activeUploads.reduce((sum, t) => sum + t.totalBytes, 0);
    const transferred = activeUploads.reduce((sum, t) => sum + t.transferredBytes, 0);
    const avgProgress =
      activeUploads.length > 0
        ? Math.round(activeUploads.reduce((sum, t) => sum + t.progress, 0) / activeUploads.length)
        : 100;
    return {
      total: uploadBatch.total,
      completed: uploadBatch.completed,
      totalBytes,
      transferred,
      progress: avgProgress,
    };
  }, [activeUploads, uploadBatch]);

  // Preview state
  const [previewVisible, setPreviewVisible] = React.useState(false);
  const [previewObject, setPreviewObject] = React.useState<S3Object | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewText, setPreviewText] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);

  // Dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [downloadCompleteDialog, setDownloadCompleteDialog] = React.useState<{
    name: string;
    uri: string;
  } | null>(null);

  // Track whether we've done at least one successful load
  const [initialLoaded, setInitialLoaded] = React.useState(false);

  // Thumbnail presigned URLs cache
  const [thumbnailUrls, setThumbnailUrls] = React.useState<Record<string, string>>({});

  const crumbs = React.useMemo(() => breadcrumbs(), [currentPrefix]);
  const selectedCount = selectedKeys.size;
  const fileCount = objects.filter((o) => !o.isFolder).length;

  React.useEffect(() => {
    if (bucketName) {
      setCurrentBucket(bucketName);
    }
  }, [bucketName, setCurrentBucket]);

  const loadObjects = React.useCallback(
    async (forceRefresh = false) => {
      if (!bucketName || !connectionId) return;

      // Stale-while-revalidate: show cached data instantly, then refresh in background
      if (!forceRefresh) {
        const cached = await S3Service.listObjects(connectionId, bucketName, currentPrefix);
        // listObjects now returns from cache if available (instant)
        if (cached.length > 0) {
          setObjects(cached);
          setInitialLoaded(true);
        } else {
          setLoading(true);
        }
        // Always fetch fresh data in background
        try {
          const fresh = await S3Service.listObjectsFresh(connectionId, bucketName, currentPrefix);
          setObjects(fresh);
        } catch (error: any) {
          // If we already showed cached data, swallow the error
          if (cached.length === 0) console.error('Failed to load objects:', error);
        } finally {
          setLoading(false);
          setInitialLoaded(true);
        }
      } else {
        // Explicit refresh (pull-to-refresh)
        setLoading(true);
        try {
          const fresh = await S3Service.listObjectsFresh(connectionId, bucketName, currentPrefix);
          setObjects(fresh);
        } catch (error: any) {
          console.error('Failed to load objects:', error);
        } finally {
          setLoading(false);
          setInitialLoaded(true);
        }
      }
    },
    [bucketName, connectionId, currentPrefix, setObjects, setLoading]
  );

  React.useEffect(() => {
    loadObjects();
  }, [loadObjects]);

  // Generate thumbnail URLs for image files — parallel batch with caching
  React.useEffect(() => {
    if (!connectionId || !bucketName) return;
    let cancelled = false;

    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'];
    const imageObjects = objects.filter((o) => {
      if (o.isFolder) return false;
      const ext = o.name.split('.').pop()?.toLowerCase() ?? '';
      return imageExts.includes(ext);
    });

    if (imageObjects.length === 0) {
      setThumbnailUrls({});
      return;
    }

    // Use batch parallel generator (with internal caching)
    const keys = imageObjects.slice(0, 50).map((o) => o.key);
    S3Service.batchGetPresignedUrls(connectionId, bucketName, keys, 1800)
      .then((urls) => {
        if (!cancelled) setThumbnailUrls(urls);
      })
      .catch(() => {
        // Silently skip thumbnail failures
      });

    return () => {
      cancelled = true;
    };
  }, [objects, connectionId, bucketName]);

  const handleFolderPress = React.useCallback(
    (folder: S3Object) => {
      setCurrentPrefix(folder.key);
    },
    [setCurrentPrefix]
  );

  const handleGoUp = React.useCallback(() => {
    const parts = currentPrefix.split('/').filter(Boolean);
    parts.pop();
    setCurrentPrefix(parts.length > 0 ? parts.join('/') + '/' : '');
  }, [currentPrefix, setCurrentPrefix]);

  const handleBreadcrumbPress = React.useCallback(
    (prefix: string) => {
      setCurrentPrefix(prefix);
    },
    [setCurrentPrefix]
  );

  // ── Preview ──────────────────────────────────────────────────────────────
  const handlePreview = React.useCallback(
    async (obj: S3Object) => {
      if (!bucketName || !connectionId) return;
      setPreviewObject(obj);
      setPreviewVisible(true);
      setPreviewLoading(true);
      setPreviewUrl(null);
      setPreviewText(null);

      try {
        const url = await S3Service.getPresignedUrl(connectionId, bucketName, obj.key);

        if (S3Service.isImageFile(obj.name)) {
          setPreviewUrl(url);
        } else if (S3Service.isPreviewable(obj.name)) {
          // Fetch text content
          const response = await fetch(url);
          const text = await response.text();
          // Limit to 100KB for display
          setPreviewText(
            text.length > 102400 ? text.slice(0, 102400) + '\n\n... (truncated)' : text
          );
        }
      } catch (error: any) {
        console.error('Preview error:', error);
        setPreviewText(null);
        setPreviewUrl(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    [bucketName, connectionId]
  );

  // ── Real Download ────────────────────────────────────────────────────────
  const downloadFile = React.useCallback(
    async (obj: S3Object) => {
      if (!bucketName || !connectionId) return;

      const taskId = generateId();
      const task: TransferTask = {
        id: taskId,
        fileName: obj.name,
        type: 'download',
        status: 'active',
        progress: 0,
        totalBytes: obj.size ?? 0,
        transferredBytes: 0,
        bucket: bucketName,
        key: obj.key,
        connectionId,
        startedAt: new Date().toISOString(),
      };
      addTask(task);

      try {
        const url = await S3Service.getPresignedUrl(connectionId, bucketName, obj.key);

        // Ensure download directory exists
        const downloadDir = FileSystem.documentDirectory + 's3downloads/';
        const dirInfo = await FileSystem.getInfoAsync(downloadDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(downloadDir, { intermediates: true });
        }

        const destUri = downloadDir + obj.name;
        updateTask(taskId, { progress: 10 });

        const downloadResult = await FileSystem.downloadAsync(url, destUri);

        updateTask(taskId, {
          progress: 100,
          transferredBytes: obj.size ?? 0,
          status: 'completed',
          localPath: downloadResult.uri,
          completedAt: new Date().toISOString(),
        });

        // Offer to share/save the file
        if (await Sharing.isAvailableAsync()) {
          setDownloadCompleteDialog({ name: obj.name, uri: downloadResult.uri });
        }
      } catch (error: any) {
        console.error('Download error:', error);
        updateTask(taskId, {
          status: 'failed',
          error: error.message || 'Download failed',
        });
      }
    },
    [bucketName, connectionId, addTask, updateTask]
  );

  const handlePull = React.useCallback(async () => {
    const selected = objects.filter((o) => selectedKeys.has(o.key) && !o.isFolder);
    for (const obj of selected) {
      downloadFile(obj);
    }
    clearSelection();
  }, [objects, selectedKeys, downloadFile, clearSelection]);

  // ── Delete selected files ────────────────────────────────────────────────
  const handleDelete = React.useCallback(() => {
    if (!bucketName || !connectionId) return;
    const selected = objects.filter((o) => selectedKeys.has(o.key) && !o.isFolder);
    if (selected.length === 0) return;
    setDeleteDialogOpen(true);
  }, [bucketName, connectionId, objects, selectedKeys]);

  const confirmDelete = React.useCallback(async () => {
    if (!bucketName || !connectionId) return;
    const selected = objects.filter((o) => selectedKeys.has(o.key) && !o.isFolder);
    try {
      await S3Service.deleteObjects(
        connectionId,
        bucketName,
        selected.map((o) => o.key)
      );
      clearSelection();
      loadObjects(true);
    } catch (error: any) {
      console.error('Delete failed:', error);
    } finally {
      setDeleteDialogOpen(false);
    }
  }, [bucketName, connectionId, objects, selectedKeys, clearSelection, loadObjects]);

  // ── Copy link for preview item ───────────────────────────────────────────
  const handlePreviewCopyLink = React.useCallback(async () => {
    if (!previewObject || !bucketName || !connectionId) return;
    try {
      const url = await S3Service.getPresignedUrl(connectionId, bucketName, previewObject.key);
      await Share.share({ message: url });
    } catch (error: any) {
      console.error('Copy link error:', error);
    }
  }, [previewObject, bucketName, connectionId]);

  // ── View / share presigned URL ───────────────────────────────────────────
  const handleShareUrls = React.useCallback(async () => {
    if (!bucketName || !connectionId) return;
    const selected = objects.filter((o) => selectedKeys.has(o.key) && !o.isFolder);
    if (selected.length === 0) return;

    try {
      const urls: string[] = [];
      for (const obj of selected) {
        const url = await S3Service.getPresignedUrl(connectionId, bucketName, obj.key);
        urls.push(selected.length > 1 ? `${obj.name}\n${url}` : url);
      }
      await Share.share({ message: urls.join('\n\n') });
    } catch (error: any) {
      console.error('Share URL error:', error);
    }
  }, [bucketName, connectionId, objects, selectedKeys]);

  // ── Real Upload (streaming via presigned URL — no full file in memory) ──
  const handleUpload = React.useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      // Initialize batch tracker
      setUploadBatch({ total: result.assets.length, completed: 0 });

      for (const asset of result.assets) {
        const key = currentPrefix + asset.name;
        const taskId = generateId();
        const mimeType = asset.mimeType || S3Service.guessMimeType(asset.name);
        const fileSize = asset.size ?? 0;

        const task: TransferTask = {
          id: taskId,
          fileName: asset.name,
          type: 'upload',
          status: 'active',
          progress: 0,
          totalBytes: fileSize,
          transferredBytes: 0,
          bucket: bucketName,
          key,
          connectionId: connectionId!,
          localPath: asset.uri,
          startedAt: new Date().toISOString(),
        };
        addTask(task);

        // Simulated progress timer — gives visual feedback while native upload streams
        let currentProgress = 5;
        // Larger files get slower simulated progress so the bar doesn't cap out too early
        const increment = fileSize > 10_000_000 ? 1.5 : fileSize > 1_000_000 ? 4 : 10;
        const interval = fileSize > 10_000_000 ? 800 : 500;
        let progressTimer: ReturnType<typeof setInterval> | null = null;

        try {
          // 1. Get presigned PUT URL (avoids loading file into JS memory)
          const presignedUrl = await S3Service.getPresignedUploadUrl(
            connectionId!,
            bucketName,
            key,
            mimeType
          );

          updateTask(taskId, { progress: currentProgress });

          // 2. Start simulated progress animation
          progressTimer = setInterval(() => {
            if (currentProgress < 90) {
              currentProgress = Math.min(90, currentProgress + increment);
              const estimatedBytes = Math.round((currentProgress / 100) * fileSize);
              updateTask(taskId, {
                progress: Math.round(currentProgress),
                transferredBytes: estimatedBytes,
              });
            }
          }, interval);

          // 3. Stream file to presigned URL via fetch + Blob (no full arrayBuffer in memory)
          const fileResponse = await fetch(asset.uri);
          const blob = await fileResponse.blob();
          await fetch(presignedUrl, {
            method: 'PUT',
            headers: { 'Content-Type': mimeType },
            body: blob,
          });

          // 4. Complete
          if (progressTimer) clearInterval(progressTimer);
          updateTask(taskId, {
            progress: 100,
            transferredBytes: fileSize,
            status: 'completed',
            completedAt: new Date().toISOString(),
          });
          setUploadBatch((prev) => (prev ? { ...prev, completed: prev.completed + 1 } : prev));
        } catch (error: any) {
          if (progressTimer) clearInterval(progressTimer);
          console.error('Upload error:', error);
          updateTask(taskId, {
            status: 'failed',
            error: error.message || 'Upload failed',
          });
          setUploadBatch((prev) => (prev ? { ...prev, completed: prev.completed + 1 } : prev));
        }
      }

      // Refresh file listing after uploads complete (invalidate cache first)
      invalidateBucketCache(connectionId!, bucketName);
      setTimeout(() => {
        loadObjects(true);
        setUploadBatch(null); // Clear batch overlay
      }, 1000);
    } catch (error: any) {
      console.error('Document picker error:', error);
    }
  }, [currentPrefix, bucketName, connectionId, addTask, updateTask, loadObjects]);

  // ── File press handler (preview for files, navigate for folders) ──────
  const handleFilePress = React.useCallback(
    (obj: S3Object) => {
      if (obj.isFolder) {
        handleFolderPress(obj);
      } else if (S3Service.isPreviewable(obj.name)) {
        handlePreview(obj);
      } else {
        toggleSelection(obj.key);
      }
    },
    [handleFolderPress, handlePreview, toggleSelection]
  );

  const renderItem = React.useCallback(
    ({ item }: { item: S3Object }) => (
      <ObjectItem
        object={item}
        isSelected={selectedKeys.has(item.key)}
        thumbnailUrl={thumbnailUrls[item.key]}
        onPress={() => handleFilePress(item)}
        onToggle={() => toggleSelection(item.key)}
      />
    ),
    [selectedKeys, thumbnailUrls, handleFilePress, toggleSelection]
  );

  const listData = React.useMemo(() => {
    if (currentPrefix) {
      const goUpItem: S3Object = {
        key: '__go_up__',
        name: '..',
        isFolder: true,
      };
      return [goUpItem, ...objects];
    }
    return objects;
  }, [objects, currentPrefix]);

  return (
    <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
      {/* Custom Header */}
      <View className="flex-row items-center gap-2 px-4 pt-3 pb-2">
        <Pressable onPress={() => router.back()} className="rounded-md p-1">
          <Icon as={ChevronLeftIcon} className="text-foreground size-6" />
        </Pressable>
        <Icon as={DatabaseIcon} className="text-foreground size-5" />
        <Text className="text-foreground flex-1 text-lg font-semibold" numberOfLines={1}>
          {bucketName}
        </Text>
        <Badge variant="secondary">
          <Text className="text-xs">{fileCount} files</Text>
        </Badge>
      </View>

      {/* Breadcrumb Navigation */}
      <View className="px-4 pb-1">
        <Breadcrumb crumbs={crumbs} onPress={handleBreadcrumbPress} />
      </View>

      {/* Column Header */}
      <View className="flex-row items-center justify-between px-4 py-2">
        <Text className="text-muted-foreground flex-1 text-xs font-medium uppercase">Name</Text>
        <Text className="text-muted-foreground w-20 text-right text-xs font-medium uppercase">
          Size
        </Text>
      </View>

      <Separator />

      {/* Object List */}
      <FlatList
        data={listData}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => {
          if (item.key === '__go_up__') {
            return (
              <Pressable
                onPress={handleGoUp}
                className="active:bg-accent flex-row items-center gap-3 px-4 py-3">
                <View className="w-6" />
                <Icon as={ChevronLeftIcon} className="text-muted-foreground size-5" />
                <Text className="text-foreground">..</Text>
              </Pressable>
            );
          }
          return renderItem({ item });
        }}
        refreshControl={
          <RefreshControl
            refreshing={initialLoaded && isLoading}
            onRefresh={() => loadObjects(true)}
          />
        }
        contentContainerClassName="pb-24"
        ListEmptyComponent={
          !initialLoaded ? (
            <ObjectListSkeleton />
          ) : (
            <EmptyState
              icon={FolderIcon}
              title="Empty"
              description="This location has no objects."
            />
          )
        }
      />

      {/* Upload Progress Overlay */}
      {uploadProgress && (
        <View
          className="border-border bg-background/95 absolute right-0 left-0 border-t px-4 py-3"
          style={{ bottom: 70 + Math.max(insets.bottom, 12) }}>
          <View className="mb-2 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Icon as={UploadIcon} className="text-primary size-4" />
              <Text className="text-foreground text-sm font-medium">
                Uploading {uploadProgress.completed}/{uploadProgress.total}
              </Text>
            </View>
            <Text className="text-foreground text-sm font-semibold">
              {uploadProgress.progress}%
            </Text>
          </View>
          <Progress
            value={uploadProgress.progress}
            className="h-2"
            indicatorClassName="bg-primary"
          />
          <Text className="text-muted-foreground mt-1 text-xs">
            {formatBytes(uploadProgress.transferred)} / {formatBytes(uploadProgress.totalBytes)}
          </Text>
        </View>
      )}

      {/* Bottom Action Bar */}
      {selectedCount > 0 && (
        <View
          className="border-border bg-background absolute right-0 bottom-0 left-0 border-t px-4 py-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-foreground text-sm font-medium">{selectedCount} selected</Text>
              <Text className="text-muted-foreground text-xs">{fileCount} Objects</Text>
            </View>
            <View className="flex-row gap-2">
              <Button variant="ghost" size="icon" onPress={handleDelete} className="size-10">
                <Icon as={Trash2Icon} className="text-destructive size-5" />
              </Button>
              <Button
                variant="outline"
                onPress={handlePull}
                className="flex-row items-center gap-2">
                <Icon as={DownloadIcon} className="text-foreground size-4" />
                <Text>Download</Text>
              </Button>
            </View>
          </View>
        </View>
      )}

      {/* Upload FAB */}
      <Pressable
        onPress={handleUpload}
        className="bg-primary active:bg-primary/80 absolute right-5 items-center justify-center rounded-full shadow-lg shadow-black/25"
        style={{
          bottom:
            selectedCount > 0 ? 80 + Math.max(insets.bottom, 12) : 24 + Math.max(insets.bottom, 12),
          width: 56,
          height: 56,
        }}>
        <Icon as={PlusIcon} className="text-primary-foreground size-6" />
      </Pressable>

      {/* File Preview Modal */}
      <FilePreview
        visible={previewVisible}
        onClose={() => setPreviewVisible(false)}
        onDownload={() => {
          setPreviewVisible(false);
          if (previewObject) downloadFile(previewObject);
        }}
        onCopyLink={handlePreviewCopyLink}
        object={previewObject}
        previewUrl={previewUrl}
        textContent={previewText}
        isLoading={previewLoading}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Files</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              {objects.filter((o) => selectedKeys.has(o.key) && !o.isFolder).length} file
              {objects.filter((o) => selectedKeys.has(o.key) && !o.isFolder).length > 1 ? 's' : ''}?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Text>Cancel</Text>
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onPress={confirmDelete}>
              <Text>Delete</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Download Complete Dialog */}
      <AlertDialog
        open={downloadCompleteDialog !== null}
        onOpenChange={(open) => {
          if (!open) setDownloadCompleteDialog(null);
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Download Complete</AlertDialogTitle>
            <AlertDialogDescription>
              {downloadCompleteDialog?.name} saved successfully.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Text>OK</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              onPress={() => {
                if (downloadCompleteDialog) {
                  Sharing.shareAsync(downloadCompleteDialog.uri);
                }
                setDownloadCompleteDialog(null);
              }}>
              <Text className="text-primary-foreground">Share</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}
