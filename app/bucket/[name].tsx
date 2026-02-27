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
import { formatBytes } from '@/lib/constants';
import {
  DownloadIcon,
  UploadIcon,
  FolderIcon,
  ChevronLeftIcon,
  EyeIcon,
  DatabaseIcon,
} from 'lucide-react-native';
import * as React from 'react';
import {
  View,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Alert,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile, Paths, Directory } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { S3Object, TransferTask } from '@/lib/types';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

export default function ObjectBrowserScreen() {
  const { name: bucketName } = useLocalSearchParams<{ name: string }>();
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

  // Preview state
  const [previewVisible, setPreviewVisible] = React.useState(false);
  const [previewObject, setPreviewObject] = React.useState<S3Object | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewText, setPreviewText] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);

  const crumbs = React.useMemo(() => breadcrumbs(), [currentPrefix]);
  const selectedCount = selectedKeys.size;
  const fileCount = objects.filter((o) => !o.isFolder).length;

  React.useEffect(() => {
    if (bucketName) {
      setCurrentBucket(bucketName);
    }
  }, [bucketName, setCurrentBucket]);

  const loadObjects = React.useCallback(async () => {
    if (!bucketName) return;
    setLoading(true);
    try {
      const result = await S3Service.listObjects(bucketName, currentPrefix);
      setObjects(result);
    } catch (error: any) {
      console.error('Failed to load objects:', error);
    } finally {
      setLoading(false);
    }
  }, [bucketName, currentPrefix, setObjects, setLoading]);

  React.useEffect(() => {
    loadObjects();
  }, [loadObjects]);

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
      if (!bucketName) return;
      setPreviewObject(obj);
      setPreviewVisible(true);
      setPreviewLoading(true);
      setPreviewUrl(null);
      setPreviewText(null);

      try {
        const url = await S3Service.getPresignedUrl(bucketName, obj.key);

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
    [bucketName]
  );

  // ── Real Download ────────────────────────────────────────────────────────
  const downloadFile = React.useCallback(
    async (obj: S3Object) => {
      if (!bucketName) return;

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
        startedAt: new Date().toISOString(),
      };
      addTask(task);

      try {
        const url = await S3Service.getPresignedUrl(bucketName, obj.key);

        // Ensure download directory exists
        const downloadDir = new Directory(Paths.document, 's3downloads');
        if (!downloadDir.exists) {
          downloadDir.create();
        }

        // Use the new expo-file-system v55 API
        const destFile = new ExpoFile(downloadDir, obj.name);
        updateTask(taskId, { progress: 10 });

        await ExpoFile.downloadFileAsync(url, destFile, { idempotent: true });

        updateTask(taskId, {
          progress: 100,
          transferredBytes: obj.size ?? 0,
          status: 'completed',
          localPath: destFile.uri,
          completedAt: new Date().toISOString(),
        });

        // Offer to share/save the file
        if (await Sharing.isAvailableAsync()) {
          Alert.alert('Download Complete', `${obj.name} saved successfully.`, [
            { text: 'OK' },
            {
              text: 'Share',
              onPress: () => Sharing.shareAsync(destFile.uri),
            },
          ]);
        }
      } catch (error: any) {
        console.error('Download error:', error);
        updateTask(taskId, {
          status: 'failed',
          error: error.message || 'Download failed',
        });
      }
    },
    [bucketName, addTask, updateTask]
  );

  const handlePull = React.useCallback(async () => {
    const selected = objects.filter((o) => selectedKeys.has(o.key) && !o.isFolder);
    for (const obj of selected) {
      downloadFile(obj);
    }
    clearSelection();
  }, [objects, selectedKeys, downloadFile, clearSelection]);

  // ── Real Upload ──────────────────────────────────────────────────────────
  const handleUpload = React.useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      for (const asset of result.assets) {
        const key = currentPrefix + asset.name;
        const taskId = generateId();
        const mimeType = asset.mimeType || S3Service.guessMimeType(asset.name);

        const task: TransferTask = {
          id: taskId,
          fileName: asset.name,
          type: 'upload',
          status: 'active',
          progress: 0,
          totalBytes: asset.size ?? 0,
          transferredBytes: 0,
          bucket: bucketName,
          key,
          localPath: asset.uri,
          startedAt: new Date().toISOString(),
        };
        addTask(task);

        // Upload using presigned PUT URL + FileSystem.uploadAsync
        try {
          updateTask(taskId, { progress: 10 });

          // Read file as blob using the new expo-file-system v55 File class
          const file = new ExpoFile(asset.uri);
          const arrayBuffer = await file.arrayBuffer();
          const body = new Uint8Array(arrayBuffer);

          updateTask(taskId, { progress: 30 });

          // Upload directly via S3 SDK PutObject
          await S3Service.uploadObject(bucketName, key, body, mimeType);

          updateTask(taskId, {
            progress: 100,
            transferredBytes: asset.size ?? 0,
            status: 'completed',
            completedAt: new Date().toISOString(),
          });
        } catch (error: any) {
          console.error('Upload error:', error);
          updateTask(taskId, {
            status: 'failed',
            error: error.message || 'Upload failed',
          });
        }
      }

      // Refresh file listing after uploads complete
      setTimeout(() => loadObjects(), 1000);
    } catch (error: any) {
      console.error('Document picker error:', error);
    }
  }, [currentPrefix, bucketName, addTask, updateTask, loadObjects]);

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
        onPress={() => handleFilePress(item)}
        onToggle={() => toggleSelection(item.key)}
      />
    ),
    [selectedKeys, handleFilePress, toggleSelection]
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
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={loadObjects} />}
        contentContainerClassName="pb-24"
        ListEmptyComponent={
          isLoading ? (
            <View className="flex-1 items-center justify-center py-20">
              <ActivityIndicator size="large" />
            </View>
          ) : (
            <EmptyState
              icon={FolderIcon}
              title="Empty"
              description="This location has no objects."
            />
          )
        }
      />

      {/* Bottom Action Bar */}
      <View
        className="border-border bg-background absolute right-0 bottom-0 left-0 border-t px-4 py-3"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
        <View className="flex-row items-center justify-between">
          <View>
            {selectedCount > 0 && (
              <Text className="text-foreground text-sm font-medium">{selectedCount} selected</Text>
            )}
            <Text className="text-muted-foreground text-xs">{fileCount} Objects</Text>
          </View>
          <View className="flex-row gap-3">
            <Button
              variant="outline"
              onPress={handlePull}
              disabled={selectedCount === 0}
              className="flex-row items-center gap-2">
              <Icon as={DownloadIcon} className="text-foreground size-4" />
              <Text>Pull</Text>
            </Button>
            <Button onPress={handleUpload} className="flex-row items-center gap-2">
              <Icon as={UploadIcon} className="text-primary-foreground size-4" />
              <Text className="text-primary-foreground">Upload</Text>
            </Button>
          </View>
        </View>
      </View>

      {/* File Preview Modal */}
      <FilePreview
        visible={previewVisible}
        onClose={() => setPreviewVisible(false)}
        onDownload={() => {
          setPreviewVisible(false);
          if (previewObject) downloadFile(previewObject);
        }}
        object={previewObject}
        previewUrl={previewUrl}
        textContent={previewText}
        isLoading={previewLoading}
      />
    </View>
  );
}
