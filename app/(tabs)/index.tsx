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
import {
  FolderIcon,
  PlusIcon,
  FilterIcon,
  AlertTriangleIcon,
  RefreshCwIcon,
  WifiOffIcon,
  GridIcon,
} from 'lucide-react-native';
import * as React from 'react';
import { View, FlatList, RefreshControl, ActivityIndicator, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function BucketIndexScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const connectionStatus = useConnectionStore((s) => s.status);
  const { buckets, isLoading, filterRegion, setBuckets, setLoading, setFilterRegion } =
    useBucketStore();

  const [showCreateDialog, setShowCreateDialog] = React.useState(false);
  const [newBucketName, setNewBucketName] = React.useState('');
  const [isCreating, setIsCreating] = React.useState(false);
  const [showFilter, setShowFilter] = React.useState(false);

  const isConnected = connectionStatus === 'connected';

  const filteredBuckets = React.useMemo(() => {
    if (!filterRegion) return buckets;
    return buckets.filter((b) => b.region === filterRegion);
  }, [buckets, filterRegion]);

  // Get unique regions for filter
  const regions = React.useMemo(() => {
    const regionSet = new Set(buckets.map((b) => b.region).filter(Boolean));
    return Array.from(regionSet) as string[];
  }, [buckets]);

  const loadBuckets = React.useCallback(async () => {
    if (!isConnected) return;
    setLoading(true);
    try {
      const result = await S3Service.listBuckets();
      setBuckets(result);
    } catch (error: any) {
      console.error('Failed to load buckets:', error);
    } finally {
      setLoading(false);
    }
  }, [isConnected, setBuckets, setLoading]);

  React.useEffect(() => {
    if (isConnected) {
      loadBuckets();
    }
  }, [isConnected, loadBuckets]);

  const handleCreateBucket = React.useCallback(async () => {
    if (!newBucketName.trim()) return;
    setIsCreating(true);
    try {
      await S3Service.createBucket(newBucketName.trim());
      setNewBucketName('');
      setShowCreateDialog(false);
      await loadBuckets();
    } catch (error: any) {
      console.error('Failed to create bucket:', error);
    } finally {
      setIsCreating(false);
    }
  }, [newBucketName, loadBuckets]);

  const handleBucketPress = React.useCallback(
    (bucketName: string) => {
      router.push(`/bucket/${bucketName}` as any);
    },
    [router]
  );

  if (!isConnected) {
    return (
      <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center gap-2 px-6 pt-4 pb-2">
          <Icon as={GridIcon} className="text-foreground size-6" />
          <Text className="text-foreground text-lg font-semibold">Index</Text>
        </View>
        <EmptyState
          icon={WifiOffIcon}
          title="Not Connected"
          description="Go to Config tab to set up your S3 connection."
        />
      </View>
    );
  }

  return (
    <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-6 pt-4 pb-2">
        <View className="mb-1 flex-row items-center gap-2">
          <Icon as={GridIcon} className="text-foreground size-6" />
          <Text className="text-foreground text-lg font-semibold">Index</Text>
        </View>
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <Text className="text-foreground text-xl font-bold">Bucket Index</Text>
            <Text className="text-muted-foreground mt-1 text-sm">
              Manage your S3 storage containers
            </Text>
          </View>
          <Pressable
            onPress={() => setShowFilter(!showFilter)}
            className="active:bg-accent rounded-md p-2">
            <Icon as={FilterIcon} className="text-muted-foreground size-5" />
          </Pressable>
        </View>

        {/* Stats & Filter */}
        <View className="mt-3 flex-row items-center gap-3">
          <Badge variant="secondary">
            <Text>{filteredBuckets.length} Buckets</Text>
          </Badge>
          <Pressable onPress={() => setFilterRegion('')}>
            <Badge variant={filterRegion ? 'outline' : 'default'}>
              <Text>All Regions</Text>
            </Badge>
          </Pressable>
        </View>

        {/* Region Filter Chips */}
        {showFilter && regions.length > 0 && (
          <View className="mt-2 flex-row flex-wrap gap-2">
            {regions.map((region) => (
              <Pressable
                key={region}
                onPress={() => setFilterRegion(region === filterRegion ? '' : region)}>
                <Badge variant={filterRegion === region ? 'default' : 'outline'}>
                  <Text>{region}</Text>
                </Badge>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <Separator className="mt-2" />

      {/* Bucket List */}
      <FlatList
        data={filteredBuckets}
        keyExtractor={(item) => item.name}
        renderItem={({ item }) => (
          <BucketItem bucket={item} onPress={() => handleBucketPress(item.name)} />
        )}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={loadBuckets} />}
        contentContainerClassName="pb-24"
        ListEmptyComponent={
          isLoading ? (
            <View className="flex-1 items-center justify-center py-20">
              <ActivityIndicator size="large" />
            </View>
          ) : (
            <EmptyState
              icon={FolderIcon}
              title="No Buckets"
              description="Create a new bucket to get started."
            />
          )
        }
      />

      {/* Create Bucket FAB */}
      <View className="absolute right-0 bottom-6 left-0 items-center px-6">
        <Button
          onPress={() => setShowCreateDialog(true)}
          className="w-full flex-row items-center gap-2"
          size="lg">
          <Icon as={PlusIcon} className="text-primary-foreground size-5" />
          <Text className="text-primary-foreground font-semibold">Create Bucket</Text>
        </Button>
      </View>

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
