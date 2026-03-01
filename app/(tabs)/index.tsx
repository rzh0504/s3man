import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
} from 'lucide-react-native';
import type { S3Provider } from '@/lib/types';
import * as React from 'react';
import { View, ScrollView, RefreshControl, ActivityIndicator, Pressable } from 'react-native';
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
}: {
  section: ProviderSection;
  collapsed: boolean;
  onToggle: () => void;
  onBucketPress: (bucket: BucketInfo) => void;
  onCreateBucket: (connectionId: string) => void;
}) {
  const conn = section.connection;
  const providerInfo = getProvider(conn.config.provider);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: withTiming(collapsed ? '0deg' : '90deg', { duration: 200 }) }],
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
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
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
  const { buckets, isLoading, setBucketsForConnection, setLoading } = useBucketStore();

  const [showCreateDialog, setShowCreateDialog] = React.useState(false);
  const [newBucketName, setNewBucketName] = React.useState('');
  const [isCreating, setIsCreating] = React.useState(false);
  const [createForConnectionId, setCreateForConnectionId] = React.useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = React.useState(false);
  const [collapsedIds, setCollapsedIds] = React.useState<Set<string>>(new Set());

  const connectedList = React.useMemo(
    () => connections.filter((c) => c.status === 'connected'),
    [connections]
  );

  const hasAnyConnection = connections.length > 0;

  // Build sections: one per connected provider
  const sections: ProviderSection[] = React.useMemo(() => {
    return connectedList.map((conn) => {
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
  }, [connectedList, buckets]);

  const totalBuckets = sections.reduce((sum, s) => sum + s.buckets.length, 0);

  // ── Collapse / Expand ──────────────────────────────────────────────────

  const toggleCollapse = React.useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

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

  React.useEffect(() => {
    if (connectedList.length > 0) {
      loadAllBuckets();
    }
  }, [connectedList.length]); // Intentionally only re-run when count changes

  // ── Create bucket ──────────────────────────────────────────────────────

  const openCreateDialog = React.useCallback((connectionId: string) => {
    setCreateForConnectionId(connectionId);
    setNewBucketName('');
    setShowCreateDialog(true);
  }, []);

  const handleCreateBucket = React.useCallback(async () => {
    if (!newBucketName.trim() || !createForConnectionId) return;
    setIsCreating(true);
    try {
      await S3Service.createBucket(createForConnectionId, newBucketName.trim());
      setNewBucketName('');
      setShowCreateDialog(false);
      const result = await S3Service.listBuckets(createForConnectionId);
      setBucketsForConnection(createForConnectionId, result);
    } catch (error: any) {
      console.error('Failed to create bucket:', error);
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

  // ── No connections at all ──────────────────────────────────────────────

  if (!hasAnyConnection) {
    return (
      <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center gap-2 px-6 pt-4 pb-2">
          <Icon as={DatabaseIcon} className="text-foreground size-5" />
          <Text className="text-foreground text-lg font-semibold">Buckets</Text>
        </View>
        <EmptyState
          icon={WifiOffIcon}
          title="No Connections"
          description="Go to Config tab to add an S3 storage provider."
        />
      </View>
    );
  }

  // ── No connected providers ─────────────────────────────────────────────

  if (connectedList.length === 0) {
    return (
      <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center gap-2 px-6 pt-4 pb-2">
          <Icon as={DatabaseIcon} className="text-foreground size-5" />
          <Text className="text-foreground text-lg font-semibold">Buckets</Text>
        </View>
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
          <View className="flex-row items-center gap-2">
            <Icon as={DatabaseIcon} className="text-foreground size-5" />
            <Text className="text-foreground text-lg font-semibold">Buckets</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Badge variant="outline">
              <Text className="text-xs">
                {connectedList.length} provider{connectedList.length > 1 ? 's' : ''} ·{' '}
                {totalBuckets} bucket{totalBuckets !== 1 ? 's' : ''}
              </Text>
            </Badge>
            <Pressable onPress={loadAllBuckets} className="active:bg-accent rounded-md p-2">
              <Icon as={RefreshCwIcon} className="text-muted-foreground size-4" />
            </Pressable>
          </View>
        </View>
      </View>

      <Separator className="mx-4" />

      {/* Grouped Bucket Sections */}
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={initialLoaded && isLoading} onRefresh={loadAllBuckets} />
        }
        contentContainerClassName="pt-3 pb-24">
        {!initialLoaded ? (
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
              collapsed={collapsedIds.has(section.connection.id)}
              onToggle={() => toggleCollapse(section.connection.id)}
              onBucketPress={handleBucketPress}
              onCreateBucket={openCreateDialog}
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
                onChangeText={setNewBucketName}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
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
    </View>
  );
}
