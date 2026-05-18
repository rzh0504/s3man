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
  SearchIcon,
  ArrowUpDownIcon,
  PencilIcon,
} from 'lucide-react-native';
import * as React from 'react';
import {
  View,
  ScrollView,
  Pressable,
  Platform,
  Share,
  ActivityIndicator,
  BackHandler,
  Alert,
  ToastAndroid,
  TextInput,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import { FlashList } from '@shopify/flash-list';
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
  registerTransferController,
  unregisterTransferController,
} from '@/lib/transfer-controller';
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

const TEXT_PREVIEW_MAX_BYTES = 102400;

type ObjectSortMode = 'name' | 'date' | 'size';
type ObjectTypeFilter = 'all' | 'images' | 'media' | 'docs' | 'other';
type ObjectAction = 'rename';
type ThumbnailUrlEntry = { url: string; createdAt: number };
type SearchResultState = { query: string; objects: S3Object[] } | null;

const OBJECT_TYPE_FILTERS: ObjectTypeFilter[] = ['all', 'images', 'media', 'docs', 'other'];
const OBJECT_SORT_MODES: ObjectSortMode[] = ['name', 'date', 'size'];
const THUMBNAIL_URL_TTL_MS = 25 * 60 * 1000;
const FAILED_THUMBNAIL_RETRY_MS = 10 * 60 * 1000;
const SEARCH_BUSY_DELAY_MS = 250;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function compareObjectNames(a: S3Object, b: S3Object): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}

function getObjectParentPrefix(key: string): string {
  const index = key.lastIndexOf('/');
  return index >= 0 ? key.slice(0, index + 1) : '';
}

function getObjectFileName(key: string): string {
  const normalized = key.replace(/\/$/, '');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function matchesTypeFilter(object: S3Object, filter: ObjectTypeFilter): boolean {
  if (filter === 'all') return true;
  if (object.isFolder) return false;
  if (filter === 'images') return S3Service.isImageFile(object.name);
  if (filter === 'media') {
    return S3Service.isAudioFile(object.name) || S3Service.isVideoFile(object.name);
  }
  if (filter === 'docs') {
    return S3Service.isCodeFile(object.name) || S3Service.isPdfFile(object.name);
  }
  return (
    !S3Service.isImageFile(object.name) &&
    !S3Service.isAudioFile(object.name) &&
    !S3Service.isVideoFile(object.name) &&
    !S3Service.isCodeFile(object.name) &&
    !S3Service.isPdfFile(object.name)
  );
}

function getEmptyObjectTitleKey(filter: ObjectTypeFilter, hasSearchQuery: boolean) {
  if (hasSearchQuery) return 'bucket.emptySearch';
  if (filter === 'images') return 'bucket.emptyImages';
  if (filter === 'media') return 'bucket.emptyMedia';
  if (filter === 'docs') return 'bucket.emptyDocs';
  if (filter === 'other') return 'bucket.emptyOther';
  return 'bucket.emptyFiles';
}

function getThumbnailCacheKey(connectionId: string, bucket: string, object: S3Object): string {
  return [connectionId, bucket, object.key, object.size ?? '', object.lastModified ?? ''].join(':');
}

function compareObjectsBySort(a: S3Object, b: S3Object, sortMode: ObjectSortMode): number {
  if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
  if (sortMode === 'date') {
    return new Date(b.lastModified ?? 0).getTime() - new Date(a.lastModified ?? 0).getTime();
  }
  if (sortMode === 'size') {
    return (b.size ?? 0) - (a.size ?? 0);
  }
  return compareObjectNames(a, b);
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
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

function silentlyReconcileObjects(connectionId: string, bucketName: string, prefix: string): void {
  void S3Service.listObjectsPage(connectionId, bucketName, prefix)
    .then((page) => {
      const state = useObjectStore.getState();
      if (
        state.currentConnectionId === connectionId &&
        state.currentBucket === bucketName &&
        state.currentPrefix === prefix
      ) {
        state.setObjects(page.objects);
      }
    })
    .catch(() => {
      // Keep the optimistic list if silent reconciliation fails.
    });
}

function createUploadDraft(asset: DocumentPicker.DocumentPickerAsset): UploadDraftFile {
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
  const [searchQuery, setSearchQuery] = React.useState('');
  const [sortMode, setSortMode] = React.useState<ObjectSortMode>('name');
  const [typeFilter, setTypeFilter] = React.useState<ObjectTypeFilter>('all');
  const [noticeMessage, setNoticeMessage] = React.useState<string | null>(null);
  const [noticeIsError, setNoticeIsError] = React.useState(false);
  const [objectAction, setObjectAction] = React.useState<ObjectAction | null>(null);
  const [objectActionTarget, setObjectActionTarget] = React.useState<S3Object | null>(null);
  const [objectActionKey, setObjectActionKey] = React.useState('');
  const [isObjectActionRunning, setIsObjectActionRunning] = React.useState(false);

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
  const [convertToWebp, setConvertToWebp] = React.useState(false);

  // Delete folder
  const [deleteFolderTarget, setDeleteFolderTarget] = React.useState<S3Object | null>(null);
  const [showDeleteFolderDialog, setShowDeleteFolderDialog] = React.useState(false);
  const [isDeletingFolder, setIsDeletingFolder] = React.useState(false);

  // Thumbnail presigned URLs cache
  const [thumbnailUrls, setThumbnailUrls] = React.useState<Record<string, ThumbnailUrlEntry>>({});
  const [failedThumbnailKeys, setFailedThumbnailKeys] = React.useState<Record<string, number>>({});
  const [visibleImageKeys, setVisibleImageKeys] = React.useState<string[]>([]);
  const [searchResults, setSearchResults] = React.useState<SearchResultState>(null);
  const [isSearchingBucket, setIsSearchingBucket] = React.useState(false);
  const [showSearchBusy, setShowSearchBusy] = React.useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = React.useState('');
  const showThumbnails = useSettingsStore((s) => s.showThumbnails);
  const downloadDirectoryUri = useSettingsStore((s) => s.downloadDirectoryUri);
  const downloadDirectoryName = useSettingsStore((s) => s.downloadDirectoryName);
  const transferConcurrency = useSettingsStore((s) => s.transferConcurrency);
  const loadRequestIdRef = React.useRef(0);
  const searchRequestIdRef = React.useRef(0);
  const [nextContinuationToken, setNextContinuationToken] = React.useState<string | undefined>();
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);

  const showSystemToast = React.useCallback((message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
      return;
    }
    Alert.alert('', message);
  }, []);

  const showNotice = React.useCallback(
    (message: string, isError = false) => {
      setNoticeMessage(message);
      setNoticeIsError(isError);
      showSystemToast(message);
      setTimeout(() => setNoticeMessage(null), 3500);
    },
    [showSystemToast]
  );

  const crumbs = React.useMemo(() => breadcrumbs(), [currentPrefix]);
  const selectedCount = selectedKeys.size;
  const proxyHeaders = React.useMemo(
    () => (connectionId ? S3Service.getProxyHeaders(connectionId) : null),
    [connectionId]
  );
  const normalizedSearchQuery = searchQuery.trim();
  const hasSearchQuery = normalizedSearchQuery.length > 0;
  const immediateFilteredObjects = React.useMemo(() => {
    const query = normalizedSearchQuery.toLowerCase();
    return objects
      .filter(
        (object) =>
          !query ||
          object.name.toLowerCase().includes(query) ||
          object.key.toLowerCase().includes(query)
      )
      .filter((object) => matchesTypeFilter(object, typeFilter))
      .slice()
      .sort((a, b) => compareObjectsBySort(a, b, sortMode));
  }, [objects, normalizedSearchQuery, sortMode, typeFilter]);
  const filteredObjects = React.useMemo(() => {
    if (hasSearchQuery && searchResults?.query === normalizedSearchQuery) {
      return searchResults.objects
        .filter((object) => matchesTypeFilter(object, typeFilter))
        .slice()
        .sort((a, b) => compareObjectsBySort(a, b, sortMode));
    }
    return immediateFilteredObjects;
  }, [
    hasSearchQuery,
    immediateFilteredObjects,
    normalizedSearchQuery,
    searchResults,
    sortMode,
    typeFilter,
  ]);
  const visibleFileCount = filteredObjects.filter((o) => !o.isFolder).length;
  const selectedObjects = React.useMemo(() => {
    const byKey = new Map<string, S3Object>();
    for (const object of objects) byKey.set(object.key, object);
    for (const object of searchResults?.objects ?? []) byKey.set(object.key, object);
    return Array.from(byKey.values()).filter((o) => selectedKeys.has(o.key) && !o.isFolder);
  }, [objects, searchResults, selectedKeys]);
  React.useEffect(() => {
    if (selectionMode && selectedCount === 0) {
      setSelectionMode(false);
    }
  }, [selectedCount, selectionMode]);
  const shouldShowSearchBusy =
    hasSearchQuery && isSearchingBucket && showSearchBusy && immediateFilteredObjects.length === 0;
  const prewarmImageKeys = React.useMemo(
    () =>
      filteredObjects
        .filter((object) => !object.isFolder && S3Service.isImageFile(object.name))
        .slice(0, 12)
        .map((object) => object.key),
    [filteredObjects]
  );
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
      })),
      { convertToWebp }
    );
    return getUploadConfigErrorText(validationError);
  }, [convertToWebp, getUploadConfigErrorText, pendingUploadFiles]);

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
    setVisibleImageKeys([]);
    setNextContinuationToken(undefined);
  }, [currentPrefix, getHasImmediateCache]);

  const transitionToPrefix = React.useCallback(
    (nextPrefix: string) => {
      setInitialLoaded(getHasImmediateCache(nextPrefix));
      setVisibleImageKeys([]);
      setNextContinuationToken(undefined);
      setCurrentPrefix(nextPrefix);
    },
    [getHasImmediateCache, setCurrentPrefix]
  );

  const isLoadRequestActive = React.useCallback(
    (requestId: number, targetConnectionId: string, targetBucket: string, targetPrefix: string) => {
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
          const fresh = await S3Service.listObjectsPage(
            targetConnectionId,
            targetBucket,
            targetPrefix
          );
          if (!isLoadRequestActive(requestId, targetConnectionId, targetBucket, targetPrefix)) {
            return;
          }
          setObjects(fresh.objects);
          setNextContinuationToken(fresh.nextContinuationToken);
        } catch (error: any) {
          if (
            !hasImmediateData &&
            isLoadRequestActive(requestId, targetConnectionId, targetBucket, targetPrefix)
          ) {
            showNotice(error?.message || 'Failed to load objects', true);
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
          const fresh = await S3Service.listObjectsPage(
            targetConnectionId,
            targetBucket,
            targetPrefix
          );
          if (!isLoadRequestActive(requestId, targetConnectionId, targetBucket, targetPrefix)) {
            return;
          }
          setObjects(fresh.objects);
          setNextContinuationToken(fresh.nextContinuationToken);
        } catch (error: any) {
          if (isLoadRequestActive(requestId, targetConnectionId, targetBucket, targetPrefix)) {
            showNotice(error?.message || 'Failed to load objects', true);
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
      showNotice,
    ]
  );

  React.useEffect(() => {
    loadObjects();
  }, [loadObjects]);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(normalizedSearchQuery), 300);
    return () => clearTimeout(timer);
  }, [normalizedSearchQuery]);

  React.useEffect(() => {
    if (!connectionId || !bucketName || !debouncedSearchQuery) {
      searchRequestIdRef.current += 1;
      setSearchResults(null);
      setIsSearchingBucket(false);
      setShowSearchBusy(false);
      return;
    }

    const requestId = ++searchRequestIdRef.current;
    let cancelled = false;
    setIsSearchingBucket(true);
    setShowSearchBusy(false);

    const busyTimer = setTimeout(() => {
      if (!cancelled && searchRequestIdRef.current === requestId) {
        setShowSearchBusy(true);
      }
    }, SEARCH_BUSY_DELAY_MS);

    S3Service.searchObjects(connectionId, bucketName, debouncedSearchQuery)
      .then((objects) => {
        if (!cancelled && searchRequestIdRef.current === requestId) {
          setSearchResults({ query: debouncedSearchQuery, objects });
        }
      })
      .catch((error: any) => {
        if (!cancelled && searchRequestIdRef.current === requestId) {
          showNotice(error?.message || t('bucket.searchFailed'), true);
        }
      })
      .finally(() => {
        if (!cancelled && searchRequestIdRef.current === requestId) {
          setIsSearchingBucket(false);
          setShowSearchBusy(false);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(busyTimer);
    };
  }, [bucketName, connectionId, debouncedSearchQuery, showNotice, t]);

  const loadMoreObjects = React.useCallback(async () => {
    if (!bucketName || !connectionId || !nextContinuationToken || isLoadingMore) return;
    const targetConnectionId = connectionId;
    const targetBucket = bucketName;
    const targetPrefix = currentPrefix;
    setIsLoadingMore(true);

    try {
      const page = await S3Service.listObjectsPage(
        targetConnectionId,
        targetBucket,
        targetPrefix,
        nextContinuationToken
      );
      const state = useObjectStore.getState();
      if (
        state.currentConnectionId !== targetConnectionId ||
        state.currentBucket !== targetBucket ||
        state.currentPrefix !== targetPrefix
      ) {
        return;
      }
      const existingKeys = new Set(state.objects.map((item) => item.key));
      const merged = [
        ...state.objects,
        ...page.objects.filter((item) => !existingKeys.has(item.key)),
      ];
      setObjects(merged);
      setNextContinuationToken(page.nextContinuationToken);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Failed to load more objects', true);
    } finally {
      setIsLoadingMore(false);
    }
  }, [
    bucketName,
    connectionId,
    currentPrefix,
    isLoadingMore,
    nextContinuationToken,
    setObjects,
    showNotice,
  ]);

  const onViewableItemsChanged = React.useCallback(
    ({ viewableItems }: { viewableItems: Array<{ item?: S3Object }> }) => {
      const nextKeys = viewableItems
        .map((token) => token.item as S3Object | undefined)
        .filter(
          (item): item is S3Object => !!item && !item.isFolder && S3Service.isImageFile(item.name)
        )
        .slice(0, 12)
        .map((item) => item.key);

      setVisibleImageKeys((prev) => {
        if (
          prev.length === nextKeys.length &&
          prev.every((key, index) => key === nextKeys[index])
        ) {
          return prev;
        }
        return nextKeys;
      });
    },
    []
  );

  const handleThumbnailError = React.useCallback((key: string) => {
    setFailedThumbnailKeys((prev) => ({ ...prev, [key]: Date.now() }));
  }, []);

  const viewabilityConfig = React.useRef({ itemVisiblePercentThreshold: 60 }).current;

  React.useEffect(() => {
    if (!connectionId || !bucketName || !showThumbnails) {
      return;
    }
    let cancelled = false;

    const now = Date.now();
    const candidateKeys = Array.from(new Set([...prewarmImageKeys, ...visibleImageKeys]));
    const pendingKeys = candidateKeys.filter((key) => {
      const entry = thumbnailUrls[key];
      const failedAt = failedThumbnailKeys[key];
      if (failedAt && now - failedAt < FAILED_THUMBNAIL_RETRY_MS) return false;
      return !entry || now - entry.createdAt > THUMBNAIL_URL_TTL_MS;
    });
    if (pendingKeys.length === 0) {
      return;
    }

    S3Service.batchGetFileUrls(connectionId, bucketName, pendingKeys.slice(0, 12), 1800)
      .then((urls) => {
        if (!cancelled) {
          const createdAt = Date.now();
          setThumbnailUrls((prev) => {
            const next = { ...prev };
            for (const [key, url] of Object.entries(urls)) {
              next[key] = { url, createdAt };
            }
            return next;
          });
          void ExpoImage.prefetch(Object.values(urls), {
            cachePolicy: 'memory-disk',
            headers: proxyHeaders ?? undefined,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          const failedAt = Date.now();
          setFailedThumbnailKeys((prev) => {
            const next = { ...prev };
            for (const key of pendingKeys) next[key] = failedAt;
            return next;
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    visibleImageKeys,
    prewarmImageKeys,
    thumbnailUrls,
    failedThumbnailKeys,
    connectionId,
    bucketName,
    proxyHeaders,
    showThumbnails,
  ]);

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
        currentConnectionId === connectionId && currentBucket === bucketName;

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
          setPreviewUrl(await S3Service.getShareUrl(connectionId, bucketName, obj.key));
        } else if (S3Service.isCodeFile(obj.name)) {
          // Fetch only the preview slice so large files do not get fully loaded into memory.
          const headers = S3Service.getProxyHeaders(connectionId) || {};
          headers.Range = `bytes=0-${TEXT_PREVIEW_MAX_BYTES - 1}`;
          const response = await fetch(url, { headers });
          const text = await response.text();
          const isTruncated = (obj.size ?? 0) > TEXT_PREVIEW_MAX_BYTES;
          setPreviewText(isTruncated ? text + '\n\n... (truncated)' : text);
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
        supportsPause: true,
        startedAt: new Date().toISOString(),
      };
      addTask(task);
      showSystemToast(t('bucket.downloadStarted', { name: obj.name }));
      let wasCancelled = false;
      let wasPaused = false;

      try {
        const url = await S3Service.getFileUrl(connectionId, bucketName, obj.key);
        const defaultLocationLabel = t('settings.downloadDirectoryDefault');
        appDownloadUri = await createUniqueAppDownloadUriAsync(obj.name);
        const isImageDownload = S3Service.isImageFile(obj.name);
        updateTask(taskId, { progress: 10 });

        const finalizeDownload = async (downloadResult: FileSystem.FileSystemDownloadResult) => {
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
              await FileSystem.deleteAsync(downloadResult.uri, { idempotent: true }).catch(
                () => {}
              );
            }
          }

          unregisterTransferController(taskId);
          updateTask(taskId, {
            progress: 100,
            transferredBytes: obj.size ?? 0,
            status: 'completed',
            localPath: finalUri,
            previewPath:
              Platform.OS === 'android' &&
              isSafDirectoryUri(downloadDirectoryUri) &&
              isImageDownload
                ? downloadResult.uri
                : undefined,
            completedAt: new Date().toISOString(),
          });
          showSystemToast(
            t('bucket.downloadCompleteDesc', { name: obj.name, location: locationLabel })
          );
        };

        const downloadResumable = FileSystem.createDownloadResumable(
          url,
          appDownloadUri,
          {
            headers: S3Service.getProxyHeaders(connectionId) || undefined,
          },
          (data) => {
            const expectedBytes =
              data.totalBytesExpectedToWrite > 0 ? data.totalBytesExpectedToWrite : (obj.size ?? 0);
            const progress =
              expectedBytes > 0
                ? Math.min(99, Math.round((data.totalBytesWritten / expectedBytes) * 100))
                : 10;
            updateTask(taskId, {
              progress,
              totalBytes: expectedBytes,
              transferredBytes: data.totalBytesWritten,
            });
          }
        );

        registerTransferController(taskId, {
          cancel: async () => {
            wasCancelled = true;
            await downloadResumable.cancelAsync();
          },
          pause: async () => {
            wasPaused = true;
            await downloadResumable.pauseAsync();
          },
          resume: async () => {
            wasPaused = false;
            const resumedResult = await downloadResumable.resumeAsync();
            if (resumedResult) {
              await finalizeDownload(resumedResult);
            }
          },
        });

        const downloadResult = await downloadResumable.downloadAsync();
        if (!downloadResult) {
          if (wasPaused || wasCancelled) return;
          throw new Error('Download stopped');
        }
        await finalizeDownload(downloadResult);
      } catch (error: any) {
        console.error('Download error:', error);
        unregisterTransferController(taskId);
        if (appDownloadUri && !wasPaused) {
          await FileSystem.deleteAsync(appDownloadUri, { idempotent: true }).catch(() => {});
        }
        if (wasPaused) return;
        updateTask(taskId, {
          status: 'failed',
          error: wasCancelled ? 'Cancelled' : error.message || 'Download failed',
        });
        if (!wasCancelled) {
          showSystemToast(error.message || t('bucket.downloadFailed'));
        }
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
    void runWithConcurrency(selectedObjects, transferConcurrency, downloadFile);
    setSelectionMode(false);
    clearSelection();
  }, [selectedObjects, transferConcurrency, downloadFile, clearSelection]);

  // ── Delete selected files ────────────────────────────────────────────────
  const handleDelete = React.useCallback(() => {
    if (!bucketName || !connectionId) return;
    if (selectedObjects.length === 0) return;
    setDeleteDialogOpen(true);
  }, [bucketName, connectionId, selectedObjects]);

  const confirmDelete = React.useCallback(async () => {
    if (!bucketName || !connectionId) return;
    const selected = selectedObjects;
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
        currentConnectionId === connectionId && currentBucket === bucketName;

      if (canIncrementallyRefresh) {
        setObjects(objects.filter((item) => !selectedKeySet.has(item.key)));
        setSearchResults((prev) =>
          prev
            ? { ...prev, objects: prev.objects.filter((item) => !selectedKeySet.has(item.key)) }
            : prev
        );
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
    selectedObjects,
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
    const selected = selectedObjects;
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
  }, [bucketName, connectionId, selectedObjects]);

  const openRenameAction = React.useCallback(() => {
    const target = selectedObjects[0];
    if (!target || selectedObjects.length !== 1) return;
    setObjectAction('rename');
    setObjectActionTarget(target);
    setObjectActionKey(getObjectFileName(target.key));
  }, [selectedObjects]);

  const handleCopyObject = React.useCallback(async () => {
    if (!bucketName || !connectionId) return;
    const target = selectedObjects[0];
    if (!target || selectedObjects.length !== 1) return;

    if (!S3Service.isImageFile(target.name)) {
      showSystemToast(t('bucket.copyFileUnsupported'));
      return;
    }

    setIsObjectActionRunning(true);
    let temporaryUri: string | null = null;
    try {
      const baseDirectory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!baseDirectory) throw new Error(t('bucket.actionFailed'));

      const url = await S3Service.getFileUrl(connectionId, bucketName, target.key);
      temporaryUri = `${baseDirectory}clipboard-${generateId()}-${target.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const downloadResult = await FileSystem.downloadAsync(url, temporaryUri, {
        headers: S3Service.getProxyHeaders(connectionId) || undefined,
      });
      const base64Image = await FileSystem.readAsStringAsync(downloadResult.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await Clipboard.setImageAsync(base64Image);
      showSystemToast(t('bucket.imageCopied'));
    } catch (error: any) {
      showSystemToast(error?.message || t('bucket.actionFailed'));
    } finally {
      if (temporaryUri) {
        await FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => {});
      }
      setIsObjectActionRunning(false);
    }
  }, [bucketName, connectionId, selectedObjects, showSystemToast, t]);

  const confirmObjectAction = React.useCallback(async () => {
    if (!objectAction || !objectActionTarget || !bucketName || !connectionId) return;
    const trimmedKey = objectActionKey.trim();
    if (!trimmedKey) return;
    const destinationKey = getObjectParentPrefix(objectActionTarget.key) + trimmedKey;

    setIsObjectActionRunning(true);
    try {
      await S3Service.moveObject(connectionId, bucketName, objectActionTarget.key, destinationKey);
      invalidateBucketCache(connectionId, bucketName);
      await clearBucketSnapshots(connectionId, bucketName);
      await loadObjects(true);
      clearSelection();
      setSelectionMode(false);
      setObjectAction(null);
      setObjectActionTarget(null);
      setObjectActionKey('');
      showNotice(t('bucket.actionSuccess'));
    } catch (error: any) {
      showNotice(error?.message || t('bucket.actionFailed'), true);
    } finally {
      setIsObjectActionRunning(false);
    }
  }, [
    objectAction,
    objectActionTarget,
    bucketName,
    connectionId,
    objectActionKey,
    clearBucketSnapshots,
    loadObjects,
    clearSelection,
    showNotice,
    t,
  ]);

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

      await runWithConcurrency(files, transferConcurrency, async (file) => {
        const result = await runUploadTask({
          connectionId,
          bucket: bucketName,
          key: prefix + file.name,
          keyPrefix: prefix,
          inputFile: file,
          targetFileName: file.name,
          imageCompression,
          convertToWebp,
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
      });

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
        setConvertToWebp(false);
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
            setConvertToWebp(false);
          })();
        }, 1000);
        return;
      }

      setUploadBatch(null);
      setPendingUploadFiles([]);
      setPendingUploadPrefix('');
      setImageCompression('original');
      setConvertToWebp(false);
    },
    [
      bucketName,
      connectionId,
      currentBucket,
      currentConnectionId,
      currentPrefix,
      uploadConfigError,
      imageCompression,
      convertToWebp,
      addTask,
      updateTask,
      objects,
      setObjects,
      clearBucketSnapshots,
      loadObjects,
      getReadableUploadError,
      transferConcurrency,
    ]
  );

  const openUploadConfigurator = React.useCallback((files: UploadDraftFile[], prefix: string) => {
    if (files.length === 0) return;
    setPendingUploadFiles(files);
    setPendingUploadPrefix(prefix);
    setImageCompression('original');
    setConvertToWebp(false);
    setShowUploadDialog(true);
  }, []);

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
        thumbnailUrl={
          failedThumbnailKeys[item.key] &&
          Date.now() - failedThumbnailKeys[item.key] < FAILED_THUMBNAIL_RETRY_MS
            ? null
            : thumbnailUrls[item.key]?.url
        }
        thumbnailCacheKey={
          connectionId && bucketName && S3Service.isImageFile(item.name)
            ? getThumbnailCacheKey(connectionId, bucketName, item)
            : null
        }
        thumbnailHeaders={proxyHeaders}
        onThumbnailError={() => handleThumbnailError(item.key)}
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
      failedThumbnailKeys,
      connectionId,
      bucketName,
      proxyHeaders,
      handleThumbnailError,
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
      return [goUpItem, ...filteredObjects];
    }
    return filteredObjects;
  }, [filteredObjects, currentPrefix]);

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
        <Badge variant="secondary">
          <Text className="text-xs">{t('bucket.files', { count: visibleFileCount })}</Text>
        </Badge>
      </View>

      {/* Breadcrumb Navigation */}
      <View className="px-4 pb-1">
        <Breadcrumb crumbs={crumbs} onPress={handleBreadcrumbPress} />
      </View>

      {noticeMessage ? (
        <NativeOnlyAnimatedView entering={fadeIn()} exiting={fadeOut()}>
          <View className="px-4 pb-2">
            <View
              className={`rounded-lg px-3 py-2 ${noticeIsError ? 'bg-destructive/10' : 'bg-green-500/10'}`}>
              <Text className={`text-sm ${noticeIsError ? 'text-destructive' : 'text-green-600'}`}>
                {noticeMessage}
              </Text>
            </View>
          </View>
        </NativeOnlyAnimatedView>
      ) : null}

      <View className="gap-2 px-4 pb-2">
        <View className="border-input bg-muted/40 flex-row items-center gap-2 rounded-xl border px-3 py-2">
          <Icon as={SearchIcon} className="text-muted-foreground size-4" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('bucket.searchPlaceholder')}
            className="text-foreground placeholder:text-muted-foreground h-8 flex-1 px-0 py-0 text-base"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View className="flex-row gap-2">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="bg-muted flex-1 rounded-lg"
            contentContainerClassName="gap-1 p-1">
            {OBJECT_TYPE_FILTERS.map((filter) => {
              const isActive = typeFilter === filter;
              const labelKey =
                filter === 'all'
                  ? 'bucket.filterAll'
                  : filter === 'images'
                    ? 'bucket.filterImages'
                    : filter === 'media'
                      ? 'bucket.filterMedia'
                      : filter === 'docs'
                        ? 'bucket.filterDocs'
                        : 'bucket.filterOther';
              return (
                <Pressable
                  key={filter}
                  onPress={() => setTypeFilter(filter)}
                  className={`min-w-16 items-center rounded-md px-3 py-1.5 ${isActive ? 'bg-background dark:bg-input/30' : ''}`}>
                  <Text
                    className={`text-xs ${isActive ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
                    numberOfLines={1}>
                    {t(labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            onPress={() => {
              const index = OBJECT_SORT_MODES.indexOf(sortMode);
              setSortMode(OBJECT_SORT_MODES[(index + 1) % OBJECT_SORT_MODES.length]);
            }}
            className="bg-muted flex-row items-center gap-1 rounded-lg px-3 py-2">
            <Icon as={ArrowUpDownIcon} className="text-muted-foreground size-4" />
            <Text className="text-muted-foreground text-xs">
              {t(
                sortMode === 'name'
                  ? 'bucket.sortName'
                  : sortMode === 'date'
                    ? 'bucket.sortDate'
                    : 'bucket.sortSize'
              )}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Column Header */}
      <View className="flex-row items-center gap-3 px-4 py-2">
        {selectionMode && (
          <Checkbox
            checked={visibleFileCount > 0 && selectedKeys.size === visibleFileCount}
            onCheckedChange={(checked) => {
              if (checked) {
                useObjectStore.setState({
                  selectedKeys: new Set(
                    filteredObjects.filter((o) => !o.isFolder).map((o) => o.key)
                  ),
                });
              } else clearSelection();
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
            <FlashList
              key={currentPrefix || '__root__'}
              data={listData}
              keyExtractor={(item) => item.key}
              extraData={{ selectedKeys, selectionMode, thumbnailUrls, failedThumbnailKeys }}
              drawDistance={480}
              getItemType={(item) => (item.isFolder ? 'folder' : 'file')}
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
              refreshing={initialLoaded && isLoading}
              onRefresh={() => loadObjects(true)}
              contentContainerStyle={{ paddingBottom: 96 }}
              ListFooterComponent={
                !hasSearchQuery && nextContinuationToken ? (
                  <View className="px-4 py-4">
                    <Button
                      variant="outline"
                      onPress={() => void loadMoreObjects()}
                      disabled={isLoadingMore}
                      className="flex-row items-center justify-center gap-2">
                      {isLoadingMore ? <ActivityIndicator size="small" /> : null}
                      <Text>{isLoadingMore ? t('bucket.loadingMore') : t('bucket.loadMore')}</Text>
                    </Button>
                  </View>
                ) : null
              }
              ListEmptyComponent={
                shouldShowSearchBusy ? (
                  <View className="flex-1 items-center justify-center gap-3 px-8 py-20">
                    <ActivityIndicator size="small" />
                    <Text className="text-muted-foreground text-sm">{t('bucket.searching')}</Text>
                  </View>
                ) : (
                  <EmptyState
                    icon={FolderIcon}
                    title={t(getEmptyObjectTitleKey(typeFilter, hasSearchQuery))}
                  />
                )
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
              </View>
              <View className="flex-row gap-2">
                {selectedObjects.length === 1 ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      onPress={openRenameAction}
                      disabled={isObjectActionRunning}
                      className="size-10">
                      <Icon as={PencilIcon} className="text-foreground size-5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onPress={() => void handleCopyObject()}
                      disabled={isObjectActionRunning}
                      className="size-10">
                      <Icon as={FileIcon} className="text-foreground size-5" />
                    </Button>
                  </>
                ) : null}
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
        previewHeaders={proxyHeaders}
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
                count: selectedObjects.length,
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

      <Dialog
        open={objectAction !== null}
        onOpenChange={(open) => {
          if (!open && !isObjectActionRunning) {
            setObjectAction(null);
            setObjectActionTarget(null);
            setObjectActionKey('');
          }
        }}>
        <DialogContent className="sm:max-w-md" style={{ width: Math.min(viewportWidth - 32, 520) }}>
          <DialogHeader>
            <DialogTitle>{t('bucket.rename')}</DialogTitle>
            <DialogDescription>{objectActionTarget?.name ?? ''}</DialogDescription>
          </DialogHeader>
          <View className="gap-2">
            <Label>{t('bucket.fileName')}</Label>
            <Input
              key={objectActionTarget?.key ?? 'rename-input'}
              defaultValue={objectActionKey}
              onChangeText={setObjectActionKey}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <DialogFooter>
            <Button
              variant="outline"
              onPress={() => {
                setObjectAction(null);
                setObjectActionTarget(null);
                setObjectActionKey('');
              }}
              disabled={isObjectActionRunning}>
              <Text>{t('cancel')}</Text>
            </Button>
            <Button
              onPress={confirmObjectAction}
              disabled={isObjectActionRunning || !objectActionKey.trim()}>
              {isObjectActionRunning ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text className="text-primary-foreground">{t('save')}</Text>
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
            setConvertToWebp(false);
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
              convertToWebp={convertToWebp}
              onFileNameChange={(id, name) => {
                setPendingUploadFiles((prev) =>
                  prev.map((file) => (file.id === id ? { ...file, name } : file))
                );
              }}
              onImageCompressionChange={setImageCompression}
              onConvertToWebpChange={setConvertToWebp}
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
                setConvertToWebp(false);
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
