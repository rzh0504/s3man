import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Separator } from '@/components/ui/separator';
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
import Animated, { useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { useT } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n';

const TABS: { value: TransferFilter; labelKey: TranslationKey; shortLabelKey: TranslationKey }[] = [
  { value: 'all', labelKey: 'all', shortLabelKey: 'all' },
  { value: 'uploading', labelKey: 'transfers.uploading', shortLabelKey: 'transfers.up' },
  { value: 'downloading', labelKey: 'transfers.downloading', shortLabelKey: 'transfers.down' },
  { value: 'completed', labelKey: 'transfers.completed', shortLabelKey: 'transfers.done' },
];

const TIMING_CONFIG = { duration: 200, easing: Easing.out(Easing.quad) };

function AnimatedTab({
  labelKey,
  shortLabelKey,
  isActive,
  onPress,
}: {
  labelKey: TranslationKey;
  shortLabelKey: TranslationKey;
  isActive: boolean;
  onPress: () => void;
}) {
  const t = useT();
  const label = t(labelKey);
  const shortLabel = t(shortLabelKey);
  const animatedStyle = useAnimatedStyle(() => ({
    flex: withTiming(isActive ? 1.6 : 1, TIMING_CONFIG),
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
  const t = useT();
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
      <View className="px-6 pt-4 pb-3">
        <View className="flex-row items-center gap-2.5">
          <Icon as={ArrowLeftRightIcon} className="text-foreground size-6" />
          <Text className="text-foreground text-xl font-bold">{t('transfers.title')}</Text>
        </View>
      </View>

      <Separator />

      {/* Filter Tabs */}
      <View className="bg-muted mx-4 my-2 flex-row gap-1 rounded-lg p-0.75">
        {TABS.map((tab) => (
          <AnimatedTab
            key={tab.value}
            labelKey={tab.labelKey}
            shortLabelKey={tab.shortLabelKey}
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
            title={t('transfers.noTransfers')}
            description={
              filter === 'all'
                ? t('transfers.noTransfersDesc')
                : t('transfers.noFilteredDesc', { filter })
            }
          />
        }
      />
    </View>
  );
}
