import { Button } from '@/components/ui/button';
import { fadeIn, fadeOut } from '@/components/ui/fade-motion';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import { ScreenTransitionView } from '@/components/ui/screen-transition-view';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ObjectItem } from '@/components/object-item';
import { Breadcrumb } from '@/components/breadcrumb';
import { EmptyState } from '@/components/empty-state';
import { FilePreview } from '@/components/file-preview';
import { InfoTooltip } from '@/components/info-tooltip';
import { UploadOptionsEditor, type UploadDraftFile } from '@/components/upload-options-editor';
import { useObjectStore } from '@/lib/stores/object-store';
import { useTransferStore } from '@/lib/stores/transfer-store';
import * as S3Service from '@/lib/s3-service';
import { formatBytes } from '@/lib/constants';
import {
  DownloadIcon,
  UploadIcon,
  FolderIcon,
  FolderPlusIcon,
  ChevronLeftIcon,
  EyeIcon,
  DatabaseIcon,
  CheckCircleIcon,
  XIcon,
  Trash2Icon,
  PlusIcon,
  ImageIcon,
  FileIcon,
} from 'lucide-react-native';
import * as React from 'react';
import {
  View,
  FlatList,
  RefreshControl,
  Pressable,
  Platform,
  Share,
  ActivityIndicator,
  BackHandler,
  Alert,
  ToastAndroid,
  useWindowDimensions,
  type ViewToken,
} from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import type { S3Object, TransferTask } from '@/lib/types';
import { Progress } from '@/components/ui/progress';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { invalidateBucketCache } from '@/lib/cache';
import {
  copyFileToSafDirectoryAsync,
  createUniqueAppDownloadUriAsync,
  formatDownloadDirectoryLabel,
  getDownloadDirectoryNameFromUri,
  isSafDirectoryUri,
} from '@/lib/download-directory';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { useT } from '@/lib/i18n';
import { runUploadTask } from '@/lib/upload-executor';
import {
  IMAGE_COMPRESSION_FAILED_ERROR,
  resolveInitialUploadFileName,
  validateUploadFileNames,
  type UploadFileNameValidationError,
  type UploadImageCompression,
} from '@/lib/upload-preprocess';
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

function compareObjectNames(a: S3Object, b: S3Object): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}

function mergeUploadedObjects(existing: S3Object[], uploaded: S3Object[]): S3Object[] {
  const folderEntries = existing.filter((item) => item.isFolder);
  const fileEntries = existing.filter((item) => !item.isFolder);
  const mergedFilesByKey = new Map(fileEntries.map((item) => [item.key, item]));

  for (const item of uploaded) {
    mergedFilesByKey.set(item.key, item);
  }

  return [
    ...folderEntries.sort(compareObjectNames),
    ...Array.from(mergedFilesByKey.values()).sort(compareObjectNames),
  ];
}

function mergeCreatedFolder(existing: S3Object[], createdFolder: S3Object): S3Object[] {
  const folderEntries = existing.filter((item) => item.isFolder);
  const fileEntries = existing.filter((item) => !item.isFolder);
  const nextFolders = new Map(folderEntries.map((item) => [item.key, item]));
  nextFolders.set(createdFolder.key, createdFolder);

  return [...Array.from(nextFolders.values()).sort(compareObjectNames), ...fileEntries];
}

function silentlyReconcileObjects(
  connectionId: string,
  bucketName: string,
  prefix: string
): void {
  void S3Service.listObjectsFresh(connectionId, bucketName, prefix)
    .then((freshObjects) => {
      const state = useObjectStore.getState();
      if (
        state.currentConnectionId === connectionId &&
        state.currentBucket === bucketName &&
        state.currentPrefix === prefix
      ) {
        state.setObjects(freshObjects);
      }
    })
    .catch(() => {
      // Keep the optimistic list if silent reconciliation fails.
    });
}

function createUploadDraft(
  asset: DocumentPicker.DocumentPickerAsset
): UploadDraftFile {
  const normalizedName = resolveInitialUploadFileName({
    providedName: asset.name,
    mimeType: asset.mimeType ?? undefined,
    uri: asset.uri,
    fallbackName: 'file',
  });

  return {
    id: generateId(),
    uri: asset.uri,
    name: normalizedName,
    originalName: normalizedName,
    size: asset.size ?? undefined,
    mimeType: asset.mimeType ?? undefined,
  };
}

function createUploadDraftFromImageAsset(asset: ImagePicker.ImagePickerAsset): UploadDraftFile {
  const normalizedName = resolveInitialUploadFileName({
    providedName: asset.fileName,
    mimeType: asset.mimeType ?? undefined,
    uri: asset.uri,
    fallbackName: asset.type === 'video' ? 'video' : 'image',
  });

  return {
    id: generateId(),
    uri: asset.uri,
    name: normalizedName,
    originalName: normalizedName,
    size: asset.fileSize ?? undefined,
    mimeType: asset.mimeType ?? undefined,
  };
}

const FILE_LIST_SKELETON_ROWS = [220, 168, 252, 184, 232, 144, 204];

function FileListSkeleton({ showGoUpRow = false }: { showGoUpRow?: boolean }) {
  return (
    <View className="flex-1" pointerEvents="none">
      {showGoUpRow && (
        <View className="flex-row items-center gap-3 px-4 py-3">
          <Skeleton className="h-4 w-6 rounded" />
          <Skeleton className="h-4 w-10 rounded" />
        </View>
      )}
      {FILE_LIST_SKELETON_ROWS.map((width, index) => (
        <View key={`${width}-${index}`} className="flex-row items-center gap-3 px-4 py-3">
          <Skeleton style={{ width: 24, height: 24, borderRadius: 6 }} />
          <Skeleton className="h-4 rounded" style={{ width, flexShrink: 1 }} />
          <Skeleton className="h-3 w-20 rounded" />
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
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const t = useT();
  const {
    currentConnectionId,
    currentBucket,
    currentPrefix,
    objects,
    selectedKeys,
    isLoading,
    setCurrentBucket,
    setCurrentPrefix,
    setObjects,
    hasPrefixCache,
    loadCachedObjects,
    clearBucketSnapshots,
    setLoading,
    toggleSelection,
    selectAll,
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
  const [isDeletingFiles, setIsDeletingFiles] = React.useState(false);

  // Track whether we've done at least one successful load
  const [initialLoaded, setInitialLoaded] = React.useState(false);

  // Selection mode — off by default, activated by long-press on file
  const [selectionMode, setSelectionMode] = React.useState(false);

  // Expandable FAB
  const [fabExpanded, setFabExpanded] = React.useState(false);

  // Create folder
  const [showCreateFolderDialog, setShowCreateFolderDialog] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState('');
  const [isCreatingFolder, setIsCreatingFolder] = React.useState(false);
  const [createFolderError, setCreateFolderError] = React.useState('');
  const [showUploadDialog, setShowUploadDialog] = React.useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = React.useState<UploadDraftFile[]>([]);
  const [pendingUploadPrefix, setPendingUploadPrefix] = React.useState('');
  const [imageCompression, setImageCompression] =
    React.useState<UploadImageCompression>('original');

  // Delete folder
  const [deleteFolderTarget, setDeleteFolderTarget] = React.useState<S3Object | null>(null);
  const [showDeleteFolderDialog, setShowDeleteFolderDialog] = React.useState(false);
  const [isDeletingFolder, setIsDeletingFolder] = React.useState(false);

  // Thumbnail presigned URLs cache
  const [thumbnailUrls, setThumbnailUrls] = React.useState<Record<string, string>>({});
  const [visibleImageKeys, setVisibleImageKeys] = React.useState<string[]>([]);
  const showThumbnails = useSettingsStore((s) => s.showThumbnails);
  const downloadDirectoryUri = useSettingsStore((s) => s.downloadDirectoryUri);
  const downloadDirectoryName = useSettingsStore((s) => s.downloadDirectoryName);
  const loadRequestIdRef = React.useRef(0);

  const showSystemToast = React.useCallback(
    (message: string) => {
      if (Platform.OS === 'android') {
        ToastAndroid.show(message, ToastAndroid.SHORT);
        return;
      }
      Alert.alert('', message);
    },
    []
  );

  const crumbs = React.useMemo(() => breadcrumbs(), [currentPrefix]);
  const selectedCount = selectedKeys.size;
  const fileCount = objects.filter((o) => !o.isFolder).length;
  const getUploadConfigErrorText = React.useCallback(
    (error: UploadFileNameValidationError | null) => {
      switch (error) {
        case 'duplicate':
          return t('uploadConfig.duplicateNames');
        case 'empty':
          return t('uploadConfig.invalidNameEmpty');
        case 'invalid_chars':
          return t('uploadConfig.invalidNameChars');
        case 'basename_missing':
          return t('uploadConfig.invalidNameBase');
        case 'trailing_dot':
          return t('uploadConfig.invalidNameTrailingDot');
        case 'extension_missing':
          return t('uploadConfig.invalidNameExtension');
        default:
          return null;
      }
    },
    [t]
  );
  const uploadConfigError = React.useMemo(() => {
    const validationError = validateUploadFileNames(
      pendingUploadFiles.map((file) => ({
        name: file.name,
        mimeType: file.mimeType,
        originalName: file.originalName,
      }))
    );
    return getUploadConfigErrorText(validationError);
  }, [getUploadConfigErrorText, pendingUploadFiles]);

  const getHasImmediateCache = React.useCallback(
    (prefix: string) => {
      if (!bucketName || !connectionId) return false;
      return (
        hasPrefixCache(connectionId, bucketName, prefix) ||
        S3Service.getCachedObjectList(connectionId, bucketName, prefix) !== undefined
      );
    },
    [bucketName, connectionId, hasPrefixCache]
  );

  React.useEffect(() => {
    if (bucketName && connectionId) {
      setCurrentBucket(connectionId, bucketName);
    }
  }, [bucketName, connectionId, setCurrentBucket]);

  React.useEffect(() => {
    setInitialLoaded(getHasImmediateCache(currentPrefix));
    setThumbnailUrls({});
    setVisibleImageKeys([]);
  }, [currentPrefix, getHasImmediateCache]);

  const transitionToPrefix = React.useCallback(
    (nextPrefix: string) => {
      setInitialLoaded(getHasImmediateCache(nextPrefix));
      setThumbnailUrls({});
      setVisibleImageKeys([]);
      setCurrentPrefix(nextPrefix);
    },
    [getHasImmediateCache, setCurrentPrefix]
  );

  const isLoadRequestActive = React.useCallback(
    (
      requestId: number,
      targetConnectionId: string,
      targetBucket: string,
      targetPrefix: string
    ) => {
      const state = useObjectStore.getState();
      return (
        loadRequestIdRef.current === requestId &&
        state.currentConnectionId === targetConnectionId &&
        state.currentBucket === targetBucket &&
        state.currentPrefix === targetPrefix
      );
    },
    []
  );

  const loadObjects = React.useCallback(
    async (forceRefresh = false) => {
      if (!bucketName || !connectionId) return;
      const targetConnectionId = connectionId;
      const targetBucket = bucketName;
      const targetPrefix = currentPrefix;

      if (currentConnectionId !== targetConnectionId || currentBucket !== targetBucket) return;

      const requestId = ++loadRequestIdRef.current;
      let hasImmediateData = false;

      const hasStoreCache = hasPrefixCache(targetConnectionId, targetBucket, targetPrefix);

      if (!forceRefresh) {
        if (hasStoreCache) {
          hasImmediateData = true;
          if (isLoadRequestActive(requestId, targetConnectionId, targetBucket, targetPrefix)) {
            setInitialLoaded(true);
            setLoading(false);
          }
        } else {
          const cacheResult = await loadCachedObjects(targetConnectionId);
          if (!isLoadRequestActive(requestId, targetConnectionId, targetBucket, targetPrefix)) {
            return;
          }

          if (cacheResult.hit) {
            hasImmediateData = true;
            setInitialLoaded(true);
            setLoading(false);
          } else {
            const ttlCached = S3Service.getCachedObjectList(
              targetConnectionId,
              targetBucket,
              targetPrefix
            );
            if (ttlCached !== undefined) {
              hasImmediateData = true;
              setObjects(ttlCached, { persist: false });
              setInitialLoaded(true);
              setLoading(false);
            } else {
              setInitialLoaded(false);
              setLoading(true);
            }
          }
        }

        try {
          const fresh = await S3Service.listObjectsFresh(
            targetConnectionId,
            targetBucket,
            targetPrefix
          );
          if (!isLoadRequestActive(requestId, targetConnectionId, targetBucket, targetPrefix)) {
            return;
          }
          setObjects(fresh);
        } catch (error: any) {
          if (
            !hasImmediateData &&
            isLoadRequestActive(requestId, targetConnectionId, targetBucket, targetPrefix)
          ) {
            console.error('Failed to load objects:', error);
          }
        } finally {
          if (isLoadRequestActive(requestId, targetConnectionId, targetBucket, targetPrefix)) {
            setLoading(false);
            setInitialLoaded(true);
          }
        }
      } else {
        setLoading(true);
        try {
          const fresh = await S3Service.listObjectsFresh(
            targetConnectionId,
            targetBucket,
            targetPrefix
          );
          if (!isLoadRequestActive(requestId, targetConnectionId, targetBucket, targetPrefix)) {
            return;
          }
          setObjects(fresh);
        } catch (error: any) {
          if (isLoadRequestActive(requestId, targetConnectionId, targetBucket, targetPrefix)) {
            console.error('Failed to load objects:', error);
          }
        } finally {
          if (isLoadRequestActive(requestId, targetConnectionId, targetBucket, targetPrefix)) {
            setLoading(false);
            setInitialLoaded(true);
          }
        }
      }
    },
    [
      bucketName,
      connectionId,
      currentBucket,
      currentConnectionId,
      currentPrefix,
      hasPrefixCache,
      setObjects,
      loadCachedObjects,
      setLoading,
      isLoadRequestActive,
    ]
  );

  React.useEffect(() => {
    loadObjects();
  }, [loadObjects]);

  const onViewableItemsChanged = React.useCallback(
    ({ viewableItems }: { viewableItems: Array<ViewToken> }) => {
      const nextKeys = viewableItems
        .map((token) => token.item as S3Object | undefined)
        .filter(
          (item): item is S3Object => !!item && !item.isFolder && S3Service.isImageFile(item.name)
        )
        .slice(0, 12)
        .map((item) => item.key);

      setVisibleImageKeys((prev) => {
        if (prev.length === nextKeys.length && prev.every((key, index) => key === nextKeys[index])) {
          return prev;
        }
        return nextKeys;
      });
    },
    []
  );

  const viewabilityConfig = React.useRef({ itemVisiblePercentThreshold: 60 }).current;

  React.useEffect(() => {
    if (!connectionId || !bucketName || !showThumbnails) {
      return;
    }
    let cancelled = false;

    const pendingKeys = visibleImageKeys.filter((key) => !thumbnailUrls[key]);
    if (pendingKeys.length === 0) {
      return;
    }

    S3Service.batchGetFileUrls(connectionId, bucketName, pendingKeys.slice(0, 12), 1800)
      .then((urls) => {
        if (!cancelled) {
          setThumbnailUrls((prev) => ({ ...prev, ...urls }));
        }
      })
      .catch(() => {
        // Silently skip thumbnail failures
      });

    return () => {
      cancelled = true;
    };
  }, [visibleImageKeys, thumbnailUrls, connectionId, bucketName, showThumbnails]);

  const handleFolderPress = React.useCallback(
    (folder: S3Object) => {
      transitionToPrefix(folder.key);
    },
    [transitionToPrefix]
  );

  const handleFolderLongPress = React.useCallback((folder: S3Object) => {
    setDeleteFolderTarget(folder);
    setShowDeleteFolderDialog(true);
  }, []);

  // ── Create folder ──────────────────────────────────────────────────────
  const handleCreateFolder = React.useCallback(async () => {
    if (!newFolderName.trim() || !bucketName || !connectionId) return;
    setIsCreatingFolder(true);
    setCreateFolderError('');
    try {
      const targetPrefix = currentPrefix;
      const normalizedFolderName = newFolderName.trim().replace(/\/$/, '');
      const folderKey = targetPrefix + normalizedFolderName + '/';
      await S3Service.putEmptyObject(connectionId, bucketName, folderKey);
      setNewFolderName('');
      setShowCreateFolderDialog(false);
      invalidateBucketCache(connectionId, bucketName);
      const state = useObjectStore.getState();
      const canIncrementallyRefresh =
        state.currentConnectionId === connectionId &&
        state.currentBucket === bucketName &&
        state.currentPrefix === targetPrefix;

      if (canIncrementallyRefresh) {
        setObjects(
          mergeCreatedFolder(state.objects, {
            key: folderKey,
            name: normalizedFolderName,
            isFolder: true,
          })
        );
        silentlyReconcileObjects(connectionId, bucketName, targetPrefix);
      } else {
        await clearBucketSnapshots(connectionId, bucketName);
        await loadObjects(true);
      }
    } catch (error: any) {
      setCreateFolderError(error.message || 'Failed to create folder');
    } finally {
      setIsCreatingFolder(false);
    }
  }, [
    newFolderName,
    bucketName,
    connectionId,
    currentPrefix,
    setObjects,
    clearBucketSnapshots,
    loadObjects,
  ]);

  // ── Delete folder ──────────────────────────────────────────────────────
  const confirmDeleteFolder = React.useCallback(async () => {
    if (!deleteFolderTarget || !bucketName || !connectionId) return;
    setIsDeletingFolder(true);
    try {
      await S3Service.deleteFolderRecursive(connectionId, bucketName, deleteFolderTarget.key);
      setShowDeleteFolderDialog(false);
      setDeleteFolderTarget(null);
      invalidateBucketCache(connectionId, bucketName);
      const canIncrementallyRefresh =
        currentConnectionId === connectionId &&
        currentBucket === bucketName;

      if (canIncrementallyRefresh) {
        setObjects(objects.filter((item) => item.key !== deleteFolderTarget.key));
        silentlyReconcileObjects(connectionId, bucketName, currentPrefix);
      } else {
        await clearBucketSnapshots(connectionId, bucketName);
        await loadObjects(true);
      }
    } catch (error: any) {
      console.error('Delete folder failed:', error);
    } finally {
      setIsDeletingFolder(false);
    }
  }, [
    deleteFolderTarget,
    bucketName,
    connectionId,
    currentBucket,
    currentConnectionId,
    currentPrefix,
    objects,
    setObjects,
    clearBucketSnapshots,
    loadObjects,
  ]);

  const handleGoUp = React.useCallback(() => {
    const parts = currentPrefix.split('/').filter(Boolean);
    parts.pop();
    transitionToPrefix(parts.length > 0 ? parts.join('/') + '/' : '');
  }, [currentPrefix, transitionToPrefix]);

  const handleBreadcrumbPress = React.useCallback(
    (prefix: string) => {
      transitionToPrefix(prefix);
    },
    [transitionToPrefix]
  );

  // ── Preview ──────────────────────────────────────────────────────────────
  const handlePreview = React.useCallback(
    async (obj: S3Object) => {
      if (!bucketName || !connectionId) return;
      setPreviewObject(obj);
      setPreviewVisible(true);
      setPreviewUrl(null);
      setPreviewText(null);

      // Non-previewable files — show info sheet with download immediately
      if (!S3Service.isPreviewable(obj.name)) {
        setPreviewLoading(false);
        return;
      }

      setPreviewLoading(true);

      try {
        const url = await S3Service.getFileUrl(connectionId, bucketName, obj.key);

        if (
          S3Service.isImageFile(obj.name) ||
          S3Service.isAudioFile(obj.name) ||
          S3Service.isVideoFile(obj.name)
        ) {
          setPreviewUrl(url);
        } else if (S3Service.isPdfFile(obj.name)) {
          // PDF: store the URL so preview can offer "open in browser"
          setPreviewUrl(url);
        } else if (S3Service.isCodeFile(obj.name)) {
          // Fetch text content for code/text files
          const headers = S3Service.getProxyHeaders(connectionId) || {};
          const response = await fetch(url, { headers });
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
      let appDownloadUri: string | null = null;
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
      showSystemToast(t('bucket.downloadStarted', { name: obj.name }));

      try {
        const url = await S3Service.getFileUrl(connectionId, bucketName, obj.key);
        const defaultLocationLabel = t('settings.downloadDirectoryDefault');
        appDownloadUri = await createUniqueAppDownloadUriAsync(obj.name);
        const isImageDownload = S3Service.isImageFile(obj.name);
        updateTask(taskId, { progress: 10 });

        const downloadResult = await FileSystem.downloadAsync(url, appDownloadUri, {
          headers: S3Service.getProxyHeaders(connectionId) || undefined,
        });

        let finalUri = downloadResult.uri;
        let locationLabel = defaultLocationLabel;

        if (Platform.OS === 'android' && isSafDirectoryUri(downloadDirectoryUri)) {
          finalUri = await copyFileToSafDirectoryAsync({
            sourceUri: downloadResult.uri,
            directoryUri: downloadDirectoryUri,
            fileName: obj.name,
            mimeType: S3Service.guessMimeType(obj.name),
          });
          locationLabel = formatDownloadDirectoryLabel(
            downloadDirectoryName || getDownloadDirectoryNameFromUri(downloadDirectoryUri)
          );
          if (!isImageDownload) {
            await FileSystem.deleteAsync(downloadResult.uri, { idempotent: true }).catch(() => {});
          }
        }

        updateTask(taskId, {
          progress: 100,
          transferredBytes: obj.size ?? 0,
          status: 'completed',
          localPath: finalUri,
          previewPath:
            Platform.OS === 'android' && isSafDirectoryUri(downloadDirectoryUri) && isImageDownload
              ? downloadResult.uri
              : undefined,
          completedAt: new Date().toISOString(),
        });
        showSystemToast(t('bucket.downloadCompleteDesc', { name: obj.name, location: locationLabel }));
      } catch (error: any) {
        console.error('Download error:', error);
        if (appDownloadUri) {
          await FileSystem.deleteAsync(appDownloadUri, { idempotent: true }).catch(() => {});
        }
        updateTask(taskId, {
          status: 'failed',
          error: error.message || 'Download failed',
        });
        showSystemToast(error.message || t('bucket.downloadFailed'));
      }
    },
    [
      bucketName,
      connectionId,
      addTask,
      updateTask,
      downloadDirectoryUri,
      downloadDirectoryName,
      showSystemToast,
      t,
    ]
  );

  const handlePull = React.useCallback(async () => {
    const selected = objects.filter((o) => selectedKeys.has(o.key) && !o.isFolder);
    for (const obj of selected) {
      downloadFile(obj);
    }
    setSelectionMode(false);
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
    const selectedKeySet = new Set(selected.map((item) => item.key));
    setIsDeletingFiles(true);
    try {
      await S3Service.deleteObjects(
        connectionId,
        bucketName,
        selected.map((o) => o.key)
      );
      clearSelection();
      setSelectionMode(false);
      invalidateBucketCache(connectionId, bucketName);

      const canIncrementallyRefresh =
        currentConnectionId === connectionId &&
        currentBucket === bucketName;

      if (canIncrementallyRefresh) {
        setObjects(objects.filter((item) => !selectedKeySet.has(item.key)));
        silentlyReconcileObjects(connectionId, bucketName, currentPrefix);
      } else {
        await clearBucketSnapshots(connectionId, bucketName);
        await loadObjects(true);
      }
    } catch (error: any) {
      console.error('Delete failed:', error);
    } finally {
      setIsDeletingFiles(false);
      setDeleteDialogOpen(false);
    }
  }, [
    bucketName,
    connectionId,
    objects,
    selectedKeys,
    currentBucket,
    currentConnectionId,
    currentPrefix,
    clearSelection,
    setObjects,
    clearBucketSnapshots,
    loadObjects,
  ]);

  // ── Copy link for preview item ───────────────────────────────────────────
  const handlePreviewCopyLink = React.useCallback(async () => {
    if (!previewObject || !bucketName || !connectionId) return;
    try {
      const url = await S3Service.getShareUrl(connectionId, bucketName, previewObject.key);
      await Share.share({ message: url });
    } catch (error: any) {
      console.error('Copy link error:', error);
    }
  }, [previewObject, bucketName, connectionId]);

  // ── View / share URL ─────────────────────────────────────────────────────
  const handleShareUrls = React.useCallback(async () => {
    if (!bucketName || !connectionId) return;
    const selected = objects.filter((o) => selectedKeys.has(o.key) && !o.isFolder);
    if (selected.length === 0) return;

    try {
      const urls: string[] = [];
      for (const obj of selected) {
        const url = await S3Service.getShareUrl(connectionId, bucketName, obj.key);
        urls.push(selected.length > 1 ? `${obj.name}\n${url}` : url);
      }
      await Share.share({ message: urls.join('\n\n') });
    } catch (error: any) {
      console.error('Share URL error:', error);
    }
  }, [bucketName, connectionId, objects, selectedKeys]);

  const getReadableUploadError = React.useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Upload failed';
      if (message === IMAGE_COMPRESSION_FAILED_ERROR) {
        return t('uploadConfig.imageCompressionFailed');
      }
      return message;
    },
    [t]
  );

  const startUpload = React.useCallback(
    async (files: UploadDraftFile[], prefix: string) => {
      if (!bucketName || !connectionId || files.length === 0 || uploadConfigError) {
        return;
      }

      setShowUploadDialog(false);
      setUploadBatch({ total: files.length, completed: 0 });
      const uploadedObjects: S3Object[] = [];

      for (const file of files) {
        const result = await runUploadTask({
          connectionId,
          bucket: bucketName,
          key: prefix + file.name,
          inputFile: file,
          targetFileName: file.name,
          imageCompression,
          addTask,
          updateTask,
          mapError: getReadableUploadError,
        });

        if (result.success && result.object) {
          uploadedObjects.push(result.object);
        } else if (!result.success) {
          console.error('Upload error:', result.error);
        }

        setUploadBatch((prev) => (prev ? { ...prev, completed: prev.completed + 1 } : prev));
      }

      invalidateBucketCache(connectionId, bucketName);
      const canIncrementallyRefresh =
        uploadedObjects.length > 0 &&
        currentConnectionId === connectionId &&
        currentBucket === bucketName &&
        currentPrefix === prefix;

      if (canIncrementallyRefresh) {
        setObjects(mergeUploadedObjects(objects, uploadedObjects));
        silentlyReconcileObjects(connectionId, bucketName, prefix);
        setUploadBatch(null);
        setPendingUploadFiles([]);
        setPendingUploadPrefix('');
        setImageCompression('original');
        return;
      }

      if (uploadedObjects.length > 0) {
        setTimeout(() => {
          void (async () => {
            await clearBucketSnapshots(connectionId, bucketName);
            await loadObjects(true);
            setUploadBatch(null);
            setPendingUploadFiles([]);
            setPendingUploadPrefix('');
            setImageCompression('original');
          })();
        }, 1000);
        return;
      }

      setUploadBatch(null);
      setPendingUploadFiles([]);
      setPendingUploadPrefix('');
      setImageCompression('original');
    },
    [
      bucketName,
      connectionId,
      currentBucket,
      currentConnectionId,
      currentPrefix,
      uploadConfigError,
      imageCompression,
      addTask,
      updateTask,
      objects,
      setObjects,
      clearBucketSnapshots,
      loadObjects,
      getReadableUploadError,
    ]
  );

  const openUploadConfigurator = React.useCallback(
    (files: UploadDraftFile[], prefix: string) => {
      if (files.length === 0) return;
      setPendingUploadFiles(files);
      setPendingUploadPrefix(prefix);
      setImageCompression('original');
      setShowUploadDialog(true);
    },
    []
  );

  const handlePickFiles = React.useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      openUploadConfigurator(result.assets.map(createUploadDraft), currentPrefix);
    } catch (error: any) {
      console.error('Document picker error:', error);
    }
  }, [currentPrefix, openUploadConfigurator]);

  const handlePickFromLibrary = React.useCallback(async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('share.error'), t('bucket.mediaPermissionDenied'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        quality: 1,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      });

      if (result.canceled) return;

      openUploadConfigurator(result.assets.map(createUploadDraftFromImageAsset), currentPrefix);
    } catch (error: any) {
      console.error('Image picker error:', error);
      Alert.alert(t('share.error'), error?.message || t('bucket.pickMediaFailed'));
    }
  }, [currentPrefix, openUploadConfigurator, t]);

  // ── File press handler (preview for files, navigate for folders) ──────
  const handleFilePress = React.useCallback(
    (obj: S3Object) => {
      if (obj.isFolder) {
        handleFolderPress(obj);
      } else if (selectionMode) {
        // In selection mode, tap toggles selection
        toggleSelection(obj.key);
      } else {
        // Always open preview sheet — FilePreview handles non-previewable files
        // with a "download" button & file info
        handlePreview(obj);
      }
    },
    [handleFolderPress, handlePreview, toggleSelection, selectionMode]
  );

  const handleFileLongPress = React.useCallback(
    (obj: S3Object) => {
      if (obj.isFolder) return;
      setSelectionMode(true);
      setFabExpanded(false);
      if (!selectedKeys.has(obj.key)) {
        toggleSelection(obj.key);
      }
    },
    [selectedKeys, toggleSelection]
  );

  const exitSelectionMode = React.useCallback(() => {
    setSelectionMode(false);
    clearSelection();
  }, [clearSelection]);

  // ── Unified back handler: preview → selection mode → folder up → pop screen
  //
  // Priority:
  //   1. Close preview sheet (if open)
  //   2. Exit selection mode (if active)
  //   3. Go up one folder level (if inside a sub-folder)
  //   4. Let the default navigation happen (pop to bucket list)

  const shouldInterceptBack = previewVisible || selectionMode || currentPrefix !== '';

  React.useEffect(() => {
    if (!shouldInterceptBack) return;

    // Android hardware back button
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (previewVisible) {
        setPreviewVisible(false);
      } else if (selectionMode) {
        exitSelectionMode();
      } else if (currentPrefix !== '') {
        handleGoUp();
      }
      return true;
    });

    // iOS swipe-back gesture & header back button
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (previewVisible) {
        e.preventDefault();
        setPreviewVisible(false);
      } else if (selectionMode) {
        e.preventDefault();
        exitSelectionMode();
      } else if (currentPrefix !== '') {
        e.preventDefault();
        handleGoUp();
      }
    });

    return () => {
      backHandler.remove();
      unsubscribe();
    };
  }, [
    shouldInterceptBack,
    previewVisible,
    selectionMode,
    currentPrefix,
    exitSelectionMode,
    handleGoUp,
    navigation,
  ]);

  const renderItem = React.useCallback(
    ({ item }: { item: S3Object }) => (
      <ObjectItem
        object={item}
        isSelected={selectedKeys.has(item.key)}
        selectionMode={selectionMode}
        thumbnailUrl={thumbnailUrls[item.key]}
        onPress={() => handleFilePress(item)}
        onToggle={() => toggleSelection(item.key)}
        onLongPress={
          item.isFolder ? () => handleFolderLongPress(item) : () => handleFileLongPress(item)
        }
      />
    ),
    [
      selectedKeys,
      selectionMode,
      thumbnailUrls,
      handleFilePress,
      toggleSelection,
      handleFolderLongPress,
      handleFileLongPress,
    ]
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
    <ScreenTransitionView className="bg-background flex-1" style={{ paddingTop: insets.top }}>
      {/* Custom Header */}
      <View className="flex-row items-center gap-2 px-4 pt-3 pb-2">
        <Pressable
          onPress={() => {
            if (selectionMode) {
              exitSelectionMode();
            } else if (currentPrefix !== '') {
              handleGoUp();
            } else {
              router.back();
            }
          }}
          className="rounded-md p-1">
          <Icon as={selectionMode ? XIcon : ChevronLeftIcon} className="text-foreground size-6" />
        </Pressable>
        <Icon as={DatabaseIcon} className="text-foreground size-5" />
        <Text className="text-foreground flex-1 text-lg font-semibold" numberOfLines={1}>
          {bucketName}
        </Text>
        {!selectionMode && selectedCount === 0 && <InfoTooltip text={t('bucket.longPressHint')} />}
        <Badge variant="secondary">
          <Text className="text-xs">{t('bucket.files', { count: fileCount })}</Text>
        </Badge>
      </View>

      {/* Breadcrumb Navigation */}
      <View className="px-4 pb-1">
        <Breadcrumb crumbs={crumbs} onPress={handleBreadcrumbPress} />
      </View>

      {/* Column Header */}
      <View className="flex-row items-center gap-3 px-4 py-2">
        {selectionMode && (
          <Checkbox
            checked={fileCount > 0 && selectedKeys.size === fileCount}
            onCheckedChange={(checked) => {
              if (checked) selectAll();
              else clearSelection();
            }}
          />
        )}
        <Text className="text-muted-foreground flex-1 text-xs font-medium uppercase">
          {t('bucket.fileHeader')}
        </Text>
        <Text className="text-muted-foreground w-16 text-right text-xs font-medium uppercase">
          {t('bucket.sizeHeader')}
        </Text>
      </View>

      <Separator />

      {/* Object List */}
      <View className="flex-1">
        <NativeOnlyAnimatedView
          key={`${currentPrefix || '__root__'}:${initialLoaded ? 'loaded' : 'loading'}`}
          entering={fadeIn(40)}
          exiting={fadeOut()}
          className="flex-1">
          {initialLoaded ? (
            <FlatList
              key={currentPrefix || '__root__'}
              data={listData}
              keyExtractor={(item) => item.key}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={5}
              removeClippedSubviews={Platform.OS !== 'web'}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              renderItem={({ item }) => {
                if (item.key === '__go_up__') {
                  return (
                    <Pressable
                      onPress={handleGoUp}
                      className="active:bg-accent flex-row items-center gap-3 px-4 py-3">
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
                <EmptyState
                  icon={FolderIcon}
                  title={t('bucket.empty')}
                  description={t('bucket.emptyDesc')}
                />
              }
            />
          ) : (
            <FileListSkeleton showGoUpRow={currentPrefix !== ''} />
          )}
        </NativeOnlyAnimatedView>
      </View>

      {/* Upload Progress Overlay */}
      {uploadProgress && (
        <NativeOnlyAnimatedView entering={fadeIn()} exiting={fadeOut()}>
          <View
            className="border-border bg-background/95 absolute right-0 left-0 border-t px-4 py-3"
            style={{ bottom: 70 + Math.max(insets.bottom, 12) }}>
            <View className="mb-2 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Icon as={UploadIcon} className="text-primary size-4" />
                <Text className="text-foreground text-sm font-medium">
                  {t('bucket.uploadingProgress', {
                    completed: uploadProgress.completed,
                    total: uploadProgress.total,
                  })}
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
        </NativeOnlyAnimatedView>
      )}

      {/* Bottom Action Bar */}
      {selectedCount > 0 && (
        <NativeOnlyAnimatedView entering={fadeIn()} exiting={fadeOut()}>
          <View
            className="border-border bg-background absolute right-0 bottom-0 left-0 border-t px-4 py-3"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-foreground text-sm font-medium">
                  {t('bucket.selectedCount', { count: selectedCount })}
                </Text>
                <Text className="text-muted-foreground text-xs">
                  {t('bucket.objectCount', { count: fileCount })}
                </Text>
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
                  <Text>{t('bucket.download')}</Text>
                </Button>
              </View>
            </View>
          </View>
        </NativeOnlyAnimatedView>
      )}

      {/* FAB backdrop */}
      {fabExpanded && (
        <NativeOnlyAnimatedView entering={fadeIn()} exiting={fadeOut()}>
          <Pressable
            onPress={() => setFabExpanded(false)}
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}
          />
        </NativeOnlyAnimatedView>
      )}

      {/* FAB — Expandable actions */}
      {!selectionMode && (
        <View
          className="absolute right-5 items-end gap-3"
          style={{
            bottom: 24 + Math.max(insets.bottom, 12),
          }}>
          {fabExpanded && (
            <NativeOnlyAnimatedView entering={fadeIn()} exiting={fadeOut()}>
              <View className="items-end gap-3">
                <Pressable
                  onPress={() => {
                    setFabExpanded(false);
                    void handlePickFromLibrary();
                  }}
                  className="bg-secondary active:bg-secondary/80 flex-row items-center gap-2 rounded-full px-4 shadow-lg shadow-black/25"
                  style={{ height: 44 }}>
                  <Icon as={ImageIcon} className="text-secondary-foreground size-5" />
                  <Text className="text-secondary-foreground text-sm font-medium">
                    {t('bucket.uploadPhotos')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setFabExpanded(false);
                    void handlePickFiles();
                  }}
                  className="bg-secondary active:bg-secondary/80 flex-row items-center gap-2 rounded-full px-4 shadow-lg shadow-black/25"
                  style={{ height: 44 }}>
                  <Icon as={FileIcon} className="text-secondary-foreground size-5" />
                  <Text className="text-secondary-foreground text-sm font-medium">
                    {t('bucket.uploadFiles')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setFabExpanded(false);
                    setNewFolderName('');
                    setCreateFolderError('');
                    setShowCreateFolderDialog(true);
                  }}
                  className="bg-secondary active:bg-secondary/80 flex-row items-center gap-2 rounded-full px-4 shadow-lg shadow-black/25"
                  style={{ height: 44 }}>
                  <Icon as={FolderPlusIcon} className="text-secondary-foreground size-5" />
                  <Text className="text-secondary-foreground text-sm font-medium">
                    {t('bucket.newFolder')}
                  </Text>
                </Pressable>
              </View>
            </NativeOnlyAnimatedView>
          )}
          <Pressable
            onPress={() => setFabExpanded((v) => !v)}
            className="bg-primary active:bg-primary/80 items-center justify-center rounded-full shadow-lg shadow-black/25"
            style={{ width: 56, height: 56 }}>
            <Icon as={fabExpanded ? XIcon : PlusIcon} className="text-primary-foreground size-6" />
          </Pressable>
        </View>
      )}

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
            <AlertDialogTitle>{t('bucket.deleteFiles')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('bucket.deleteFilesDesc', {
                count: objects.filter((o) => selectedKeys.has(o.key) && !o.isFolder).length,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingFiles}>
              <Text>{t('cancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onPress={confirmDelete}
              disabled={isDeletingFiles}>
              {isDeletingFiles && <ActivityIndicator size="small" color="#fff" />}
              <Text>{isDeletingFiles ? t('bucket.deletingFiles') : t('delete')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Folder Dialog */}
      <Dialog open={showCreateFolderDialog} onOpenChange={setShowCreateFolderDialog}>
        <DialogContent
          className="sm:max-w-md"
          style={{
            width: Math.min(viewportWidth - 32, 520),
          }}>
          <DialogHeader>
            <DialogTitle>{t('bucket.createFolder')}</DialogTitle>
            <DialogDescription>{t('bucket.createFolderDesc')}</DialogDescription>
          </DialogHeader>
          <View className="gap-4">
            <View className="gap-2">
              <Label>{t('bucket.folderName')}</Label>
              <Input
                placeholder={t('bucket.folderPlaceholder')}
                value={newFolderName}
                onChangeText={(text) => {
                  setNewFolderName(text);
                  if (createFolderError) setCreateFolderError('');
                }}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {createFolderError ? (
              <View className="bg-destructive/10 rounded-lg p-3">
                <Text className="text-destructive text-sm">{createFolderError}</Text>
              </View>
            ) : null}
          </View>
          <DialogFooter>
            <Button variant="outline" onPress={() => setShowCreateFolderDialog(false)}>
              <Text>{t('cancel')}</Text>
            </Button>
            <Button
              onPress={handleCreateFolder}
              disabled={isCreatingFolder || !newFolderName.trim()}>
              {isCreatingFolder ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text className="text-primary-foreground">{t('create')}</Text>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Options Dialog */}
      <Dialog
        open={showUploadDialog}
        onOpenChange={(open) => {
          setShowUploadDialog(open);
          if (!open) {
            setPendingUploadFiles([]);
            setPendingUploadPrefix('');
            setImageCompression('original');
          }
        }}>
        <DialogContent
          className="sm:max-w-lg"
          style={{
            width: Math.min(viewportWidth - 32, 520),
            minHeight: Math.min(Math.max(viewportHeight * 0.34, 320), 420),
          }}>
          <DialogHeader>
            <DialogTitle>{t('uploadConfig.title')}</DialogTitle>
          </DialogHeader>
          <KeyboardAwareScrollView
            style={{
              height: Math.min(Math.max(viewportHeight * 0.22, 180), 280),
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            bottomOffset={24}
            extraKeyboardSpace={insets.bottom + 16}
            showsVerticalScrollIndicator={false}>
            <UploadOptionsEditor
              files={pendingUploadFiles}
              imageCompression={imageCompression}
              onFileNameChange={(id, name) => {
                setPendingUploadFiles((prev) =>
                  prev.map((file) => (file.id === id ? { ...file, name } : file))
                );
              }}
              onImageCompressionChange={setImageCompression}
              validationError={uploadConfigError}
            />
          </KeyboardAwareScrollView>
          <DialogFooter className="flex-row-reverse">
            <Button
              onPress={() => void startUpload(pendingUploadFiles, pendingUploadPrefix)}
              disabled={pendingUploadFiles.length === 0 || !!uploadConfigError}>
              <Text className="text-primary-foreground">{t('uploadConfig.confirm')}</Text>
            </Button>
            <Button
              variant="outline"
              onPress={() => {
                setShowUploadDialog(false);
                setPendingUploadFiles([]);
                setPendingUploadPrefix('');
                setImageCompression('original');
              }}>
              <Text>{t('cancel')}</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Confirmation */}
      <AlertDialog open={showDeleteFolderDialog} onOpenChange={setShowDeleteFolderDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('bucket.deleteFolder')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('bucket.deleteFolderDesc', { name: deleteFolderTarget?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onPress={() => {
                setShowDeleteFolderDialog(false);
                setDeleteFolderTarget(null);
              }}>
              <Text>{t('cancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onPress={confirmDeleteFolder}
              disabled={isDeletingFolder}>
              <Text>{isDeletingFolder ? t('buckets.deleting') : t('delete')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScreenTransitionView>
  );
}
