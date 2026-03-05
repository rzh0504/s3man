import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BucketItem } from '@/components/bucket-item';
import { EmptyState } from '@/components/empty-state';
import { useConnectionStore } from '@/lib/stores/connection-store';
import { useBucketStore } from '@/lib/stores/bucket-store';
import * as S3Service from '@/lib/s3-service';
import { getProvider } from '@/lib/constants';
import type { BucketInfo, S3Connection } from '@/lib/types';
import { ProviderIcon } from '@/components/provider-icons';
import {
  FolderIcon,
  PlusIcon,
  WifiOffIcon,
  DatabaseIcon,
  RefreshCwIcon,
  ChevronRightIcon,
  Trash2Icon,
} from 'lucide-react-native';
import type { S3Provider } from '@/lib/types';
import * as React from 'react';
import {
  View,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Alert,
} from 'react-native';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, withTiming } from 'react-native-reanimated';

interface ProviderSection {
  connection: S3Connection;
  buckets: BucketInfo[];
}

/** Skeleton placeholder shown while buckets load for the first time */
function BucketListSkeleton() {
  return (
    <View className="px-4 py-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i} className="flex-row items-center gap-3 py-3.5">
          <Skeleton className="size-10 rounded-lg" />
          <View className="flex-1 gap-1.5">
            <Skeleton className="h-4 w-3/5 rounded" />
            <Skeleton className="h-3 w-1/4 rounded" />
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Collapsible Provider Section ─────────────────────────────────────────

function ProviderSectionCard({
  section,
  collapsed,
  onToggle,
  onBucketPress,
  onCreateBucket,
  onDeleteBucket,
}: {
  section: ProviderSection;
  collapsed: boolean;
  onToggle: () => void;
  onBucketPress: (bucket: BucketInfo) => void;
  onCreateBucket: (connectionId: string) => void;
  onDeleteBucket: (bucket: BucketInfo) => void;
}) {
  const conn = section.connection;
  const providerInfo = getProvider(conn.config.provider);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: withTiming(collapsed ? '0deg' : '90deg', { duration: 300 }) }],
  }));

  return (
    <View className="border-border bg-card mx-4 mb-3 overflow-hidden rounded-xl border">
      {/* Header — always visible */}
      <Pressable
        onPress={onToggle}
        className="active:bg-accent/50 flex-row items-center gap-3 px-4 py-3">
        <Animated.View style={chevronStyle}>
          <Icon as={ChevronRightIcon} className="text-muted-foreground size-4" />
        </Animated.View>
        <ProviderIcon provider={conn.config.provider} size={22} />
        <View className="flex-1">
          <Text className="text-foreground text-sm font-semibold" numberOfLines={1}>
            {conn.displayName}
          </Text>
          <Text className="text-muted-foreground text-xs">{providerInfo.label}</Text>
        </View>
        <Badge variant="secondary">
          <Text className="text-xs">
            {section.buckets.length} bucket{section.buckets.length !== 1 ? 's' : ''}
          </Text>
        </Badge>
        <Pressable
          onPress={() => onCreateBucket(conn.id)}
          hitSlop={12}
          className="active:bg-accent rounded-md p-1">
          <Icon as={PlusIcon} className="text-muted-foreground size-4" />
        </Pressable>
      </Pressable>

      {/* Bucket list — collapsible */}
      {!collapsed && (
        <Animated.View entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)}>
          <Separator />
          {section.buckets.length === 0 ? (
            <View className="items-center py-6">
              <Text className="text-muted-foreground text-sm">No buckets</Text>
            </View>
          ) : (
            section.buckets.map((bucket) => (
              <BucketItem
                key={`${bucket.connectionId}-${bucket.name}`}
                bucket={bucket}
                onPress={() => onBucketPress(bucket)}
                onLongPress={() => onDeleteBucket(bucket)}
              />
            ))
          )}
        </Animated.View>
      )}
    </View>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────

export default function BucketIndexScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const connections = useConnectionStore((s) => s.connections);
  const isInitializing = useConnectionStore((s) => s.isInitializing);
  const { buckets, isLoading, hasCachedData, setBucketsForConnection, setLoading } =
    useBucketStore();

  const [showCreateDialog, setShowCreateDialog] = React.useState(false);
  const [newBucketName, setNewBucketName] = React.useState('');
  const [isCreating, setIsCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState('');
  const [createForConnectionId, setCreateForConnectionId] = React.useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = React.useState(false);
  const [collapsedIds, setCollapsedIds] = React.useState<Set<string> | 'all'>('all');

  // Delete bucket state
  const [deleteBucketTarget, setDeleteBucketTarget] = React.useState<BucketInfo | null>(null);
  const [isDeletingBucket, setIsDeletingBucket] = React.useState(false);

  const connectedList = React.useMemo(
    () => connections.filter((c) => c.status === 'connected'),
    [connections]
  );

  // Include 'connecting' connections so we don't flash 'Not Connected' during boot
  const activeOrConnectingList = React.useMemo(
    () => connections.filter((c) => c.status === 'connected' || c.status === 'connecting'),
    [connections]
  );

  const hasAnyConnection = connections.length > 0;
  const canShowCached = hasCachedData && !isInitializing;

  // Build sections: one per connected provider (or all connections when showing cached data)
  const sections: ProviderSection[] = React.useMemo(() => {
    // Before initial network fetch, use all connections to display cached data
    const displayList = connectedList.length > 0 ? connectedList : canShowCached ? connections : [];
    return displayList.map((conn) => {
      const visible = conn.config.visibleBuckets;
      const connBuckets = buckets.filter((b) => b.connectionId === conn.id);
      return {
        connection: conn,
        buckets:
          visible && visible.length > 0
            ? connBuckets.filter((b) => visible.includes(b.name))
            : connBuckets,
      };
    });
  }, [connectedList, connections, buckets, canShowCached]);

  const totalBuckets = sections.reduce((sum, s) => sum + s.buckets.length, 0);

  // ── Collapse / Expand ──────────────────────────────────────────────────

  const toggleCollapse = React.useCallback(
    (id: string) => {
      setCollapsedIds((prev) => {
        if (prev === 'all') {
          // All collapsed — expand this one (collapse the rest)
          const allIds = new Set(connectedList.map((c) => c.id));
          allIds.delete(id);
          return allIds;
        }
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [connectedList]
  );

  // ── Load buckets for ALL connected providers ───────────────────────────

  const loadAllBuckets = React.useCallback(async () => {
    if (connectedList.length === 0) return;
    setLoading(true);
    try {
      await Promise.allSettled(
        connectedList.map(async (conn) => {
          try {
            const result = await S3Service.listBuckets(conn.id);
            setBucketsForConnection(conn.id, result);
          } catch (error: any) {
            console.error(`Failed to load buckets for ${conn.displayName}:`, error);
          }
        })
      );
    } finally {
      setLoading(false);
      setInitialLoaded(true);
    }
  }, [connectedList, setBucketsForConnection, setLoading]);

  // Track connected IDs so we only reload newly-connected providers
  const prevConnectedIdsRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    const currentIds = new Set(connectedList.map((c) => c.id));
    const prevIds = prevConnectedIdsRef.current;

    // Find newly connected providers (not in previous set)
    const newIds = connectedList.filter((c) => !prevIds.has(c.id));
    prevConnectedIdsRef.current = currentIds;

    if (!initialLoaded && connectedList.length > 0) {
      // First load: fetch all
      loadAllBuckets();
    } else if (newIds.length > 0) {
      // Incremental: only load buckets for newly connected providers
      (async () => {
        setLoading(true);
        try {
          await Promise.allSettled(
            newIds.map(async (conn) => {
              try {
                const result = await S3Service.listBuckets(conn.id);
                setBucketsForConnection(conn.id, result);
              } catch (error: any) {
                console.error(`Failed to load buckets for ${conn.displayName}:`, error);
              }
            })
          );
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [connectedList]); // Re-run when connected list changes

  // ── Create bucket ──────────────────────────────────────────────────────

  const openCreateDialog = React.useCallback((connectionId: string) => {
    setCreateForConnectionId(connectionId);
    setNewBucketName('');
    setCreateError('');
    setShowCreateDialog(true);
  }, []);

  const handleCreateBucket = React.useCallback(async () => {
    if (!newBucketName.trim() || !createForConnectionId) return;
    setIsCreating(true);
    setCreateError('');
    try {
      await S3Service.createBucket(createForConnectionId, newBucketName.trim());
      setNewBucketName('');
      setShowCreateDialog(false);
      const result = await S3Service.listBuckets(createForConnectionId);
      setBucketsForConnection(createForConnectionId, result);
    } catch (error: any) {
      setCreateError(error.message || 'Failed to create bucket');
    } finally {
      setIsCreating(false);
    }
  }, [newBucketName, createForConnectionId, setBucketsForConnection]);

  const handleBucketPress = React.useCallback(
    (bucket: BucketInfo) => {
      router.push(`/bucket/${bucket.name}?connectionId=${bucket.connectionId}` as any);
    },
    [router]
  );

  // ── Delete bucket ──────────────────────────────────────────────────────

  const handleDeleteBucket = React.useCallback((bucket: BucketInfo) => {
    setDeleteBucketTarget(bucket);
  }, []);

  const confirmDeleteBucket = React.useCallback(async () => {
    if (!deleteBucketTarget) return;
    setIsDeletingBucket(true);
    try {
      await S3Service.deleteBucket(deleteBucketTarget.connectionId, deleteBucketTarget.name);
      // Refresh bucket list for that connection
      const result = await S3Service.listBuckets(deleteBucketTarget.connectionId);
      setBucketsForConnection(deleteBucketTarget.connectionId, result);
      setDeleteBucketTarget(null);
    } catch (error: any) {
      Alert.alert(
        'Delete Failed',
        error.message || 'Failed to delete bucket. Make sure the bucket is empty.'
      );
      setIsDeletingBucket(false);
    } finally {
      setIsDeletingBucket(false);
    }
  }, [deleteBucketTarget, setBucketsForConnection]);

  // ── No connections at all ──────────────────────────────────────────────
  // Show skeleton while store is still loading from SecureStore
  if (isInitializing) {
    return (
      <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center gap-2.5 px-6 pt-4 pb-3">
          <Icon as={DatabaseIcon} className="text-foreground size-6" />
          <Text className="text-foreground text-xl font-bold">Buckets</Text>
        </View>
        <Separator />
        <BucketListSkeleton />
      </View>
    );
  }
  if (!hasAnyConnection && !canShowCached) {
    return (
      <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center gap-2.5 px-6 pt-4 pb-3">
          <Icon as={DatabaseIcon} className="text-foreground size-6" />
          <Text className="text-foreground text-xl font-bold">Buckets</Text>
        </View>
        <Separator />
        <EmptyState
          icon={WifiOffIcon}
          title="No Connections"
          description="Go to Config tab to add an S3 storage provider."
        />
      </View>
    );
  }

  // ── No connected providers ─────────────────────────────────────────────

  // If some connections are still connecting, show skeleton instead of 'Not Connected'
  if (connectedList.length === 0 && activeOrConnectingList.length > 0 && !canShowCached) {
    return (
      <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center gap-2.5 px-6 pt-4 pb-3">
          <Icon as={DatabaseIcon} className="text-foreground size-6" />
          <Text className="text-foreground text-xl font-bold">Buckets</Text>
        </View>
        <Separator />
        <BucketListSkeleton />
      </View>
    );
  }

  if (connectedList.length === 0 && !canShowCached) {
    return (
      <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center gap-2.5 px-6 pt-4 pb-3">
          <Icon as={DatabaseIcon} className="text-foreground size-6" />
          <Text className="text-foreground text-xl font-bold">Buckets</Text>
        </View>
        <Separator />
        <EmptyState
          icon={WifiOffIcon}
          title="Not Connected"
          description="All connections are offline. Go to Config tab to reconnect."
        />
      </View>
    );
  }

  // ── Main content ───────────────────────────────────────────────────────

  return (
    <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-6 pt-4 pb-3">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2.5">
            <Icon as={DatabaseIcon} className="text-foreground size-6" />
            <Text className="text-foreground text-xl font-bold">Buckets</Text>
          </View>
          <Pressable onPress={loadAllBuckets} className="active:bg-accent rounded-md p-2">
            <Icon as={RefreshCwIcon} className="text-muted-foreground size-4" />
          </Pressable>
        </View>
      </View>

      <Separator />

      {/* Grouped Bucket Sections */}
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={initialLoaded && isLoading} onRefresh={loadAllBuckets} />
        }
        contentContainerClassName="pt-3 pb-24">
        {!initialLoaded && !canShowCached ? (
          <BucketListSkeleton />
        ) : sections.length === 0 ? (
          <EmptyState
            icon={FolderIcon}
            title="No Buckets"
            description="Create a new bucket to get started."
          />
        ) : (
          sections.map((section) => (
            <ProviderSectionCard
              key={section.connection.id}
              section={section}
              collapsed={collapsedIds === 'all' || collapsedIds.has(section.connection.id)}
              onToggle={() => toggleCollapse(section.connection.id)}
              onBucketPress={handleBucketPress}
              onCreateBucket={openCreateDialog}
              onDeleteBucket={handleDeleteBucket}
            />
          ))
        )}
      </ScrollView>

      {/* Create Bucket Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Bucket</DialogTitle>
            <DialogDescription>Enter a unique name for your new S3 bucket.</DialogDescription>
          </DialogHeader>
          <View className="gap-4">
            <View className="gap-2">
              <Label>Bucket Name</Label>
              <Input
                placeholder="my-new-bucket"
                value={newBucketName}
                onChangeText={(text) => {
                  setNewBucketName(text);
                  if (createError) setCreateError('');
                }}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {createError ? (
              <View className="bg-destructive/10 rounded-lg p-3">
                <Text className="text-destructive text-sm">{createError}</Text>
              </View>
            ) : null}
          </View>
          <DialogFooter>
            <Button variant="outline" onPress={() => setShowCreateDialog(false)}>
              <Text>Cancel</Text>
            </Button>
            <Button onPress={handleCreateBucket} disabled={isCreating || !newBucketName.trim()}>
              {isCreating ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text className="text-primary-foreground">Create</Text>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Bucket Confirmation */}
      <AlertDialog
        open={deleteBucketTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteBucketTarget(null);
            setIsDeletingBucket(false);
          }
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Bucket</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deleteBucketTarget?.name}"? The bucket must be empty. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onPress={() => {
                setDeleteBucketTarget(null);
                setIsDeletingBucket(false);
              }}>
              <Text>Cancel</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onPress={confirmDeleteBucket}
              disabled={isDeletingBucket}>
              <Text>{isDeletingBucket ? 'Deleting...' : 'Delete'}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}
