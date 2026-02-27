import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { TransferItem } from '@/components/transfer-item';
import { EmptyState } from '@/components/empty-state';
import { useTransferStore } from '@/lib/stores/transfer-store';
import type { TransferFilter, TransferTask } from '@/lib/types';
import {
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowLeftRightIcon,
  CheckCircleIcon,
  ListIcon,
} from 'lucide-react-native';
import * as React from 'react';
import { View, FlatList, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';

const TABS: { value: TransferFilter; label: string; shortLabel: string }[] = [
  { value: 'all', label: 'All', shortLabel: 'All' },
  { value: 'uploading', label: 'Uploading', shortLabel: 'Up' },
  { value: 'downloading', label: 'Downloading', shortLabel: 'Down' },
  { value: 'completed', label: 'Completed', shortLabel: 'Done' },
];

const SPRING_CONFIG = { damping: 18, stiffness: 200 };

function AnimatedTab({
  label,
  shortLabel,
  isActive,
  onPress,
}: {
  label: string;
  shortLabel: string;
  isActive: boolean;
  onPress: () => void;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    flex: withSpring(isActive ? 1.6 : 1, SPRING_CONFIG),
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={onPress}
        className={`items-center justify-center rounded-md py-1.5 ${
          isActive
            ? 'bg-background dark:border-foreground/10 dark:bg-input/30 border border-transparent shadow-sm shadow-black/5'
            : ''
        }`}>
        <Text
          className={`text-sm font-medium ${
            isActive ? 'text-foreground' : 'text-muted-foreground'
          }`}
          numberOfLines={1}>
          {isActive ? label : shortLabel}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export default function TransfersScreen() {
  const insets = useSafeAreaInsets();
  const { tasks, filter, setFilter, filteredTasks, pauseTask, resumeTask, cancelTask, removeTask } =
    useTransferStore();

  const displayTasks = React.useMemo(() => filteredTasks(), [tasks, filter]);

  const renderItem = React.useCallback(
    ({ item }: { item: TransferTask }) => (
      <TransferItem
        task={item}
        onPause={() => pauseTask(item.id)}
        onResume={() => resumeTask(item.id)}
        onCancel={() => cancelTask(item.id)}
        onRemove={() => removeTask(item.id)}
      />
    ),
    [pauseTask, resumeTask, cancelTask, removeTask]
  );

  return (
    <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center gap-2 px-6 pt-4 pb-2">
        <Icon as={ArrowLeftRightIcon} className="text-foreground size-6" />
        <Text className="text-foreground text-lg font-semibold">Transfers</Text>
      </View>

      {/* Filter Tabs */}
      <View className="bg-muted mx-4 my-2 flex-row gap-1 rounded-lg p-0.75">
        {TABS.map((tab) => (
          <AnimatedTab
            key={tab.value}
            label={tab.label}
            shortLabel={tab.shortLabel}
            isActive={filter === tab.value}
            onPress={() => setFilter(tab.value)}
          />
        ))}
      </View>

      {/* Transfer List */}
      <FlatList
        data={displayTasks}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerClassName="px-4 pb-6 gap-3 pt-2"
        ListEmptyComponent={
          <EmptyState
            icon={ListIcon}
            title="No Transfers"
            description={
              filter === 'all'
                ? 'Upload or download files to see transfer progress here.'
                : `No ${filter} transfers.`
            }
          />
        }
      />
    </View>
  );
}
