import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ScreenTransitionView } from '@/components/ui/screen-transition-view';
import { Text } from '@/components/ui/text';
import { Separator } from '@/components/ui/separator';
import { TransferItem } from '@/components/transfer-item';
import { EmptyState } from '@/components/empty-state';
import { useTransferStore } from '@/lib/stores/transfer-store';
import type { TransferFilter, TransferTask } from '@/lib/types';
import { ArrowLeftRightIcon, ListIcon } from 'lucide-react-native';
import * as React from 'react';
import { View, SectionList, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { useI18nStore, useT } from '@/lib/i18n';
import type { Locale, TranslationKey } from '@/lib/i18n';

const TABS: { value: TransferFilter; labelKey: TranslationKey; shortLabelKey: TranslationKey }[] = [
  { value: 'all', labelKey: 'all', shortLabelKey: 'all' },
  { value: 'uploading', labelKey: 'transfers.uploading', shortLabelKey: 'transfers.up' },
  { value: 'downloading', labelKey: 'transfers.downloading', shortLabelKey: 'transfers.down' },
  { value: 'completed', labelKey: 'transfers.completed', shortLabelKey: 'transfers.done' },
];

const TIMING_CONFIG = { duration: 200, easing: Easing.out(Easing.quad) };

type TransferSection = {
  title: string;
  key: string;
  data: TransferTask[];
};

function getDayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatSectionTitle(dayKey: string, locale: Locale, todayLabel: string) {
  const todayKey = getDayKey(new Date().toISOString());
  if (dayKey === todayKey) return todayLabel;
  if (dayKey === 'unknown') return dayKey;

  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

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
  const locale = useI18nStore((s) => s.locale);
  const { tasks, filter, setFilter, filteredTasks, pauseTask, resumeTask, cancelTask, removeTask } =
    useTransferStore();

  const displayTasks = React.useMemo(() => filteredTasks(), [tasks, filter]);
  const sections = React.useMemo<TransferSection[]>(() => {
    const grouped = new Map<string, TransferTask[]>();
    const sortedTasks = [...displayTasks].sort((a, b) => {
      const aTime = new Date(a.startedAt).getTime();
      const bTime = new Date(b.startedAt).getTime();
      return bTime - aTime;
    });

    for (const task of sortedTasks) {
      const key = getDayKey(task.startedAt);
      const existing = grouped.get(key);
      if (existing) {
        existing.push(task);
      } else {
        grouped.set(key, [task]);
      }
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, data]) => ({
        key,
        title: formatSectionTitle(key, locale, t('transfers.today')),
        data,
      }));
  }, [displayTasks, locale, t]);

  const renderItem = React.useCallback(
    ({ item }: { item: TransferTask }) => (
      <View className="mb-3 px-4">
        <TransferItem
          task={item}
          onPause={() => pauseTask(item.id)}
          onResume={() => resumeTask(item.id)}
          onCancel={() => cancelTask(item.id)}
          onRemove={() => removeTask(item.id)}
        />
      </View>
    ),
    [pauseTask, resumeTask, cancelTask, removeTask]
  );

  return (
    <ScreenTransitionView className="bg-background flex-1" style={{ paddingTop: insets.top }}>
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
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <View className="px-4 pb-2 pt-3">
            <Text className="text-muted-foreground text-xs font-medium">{section.title}</Text>
          </View>
        )}
        stickySectionHeadersEnabled={false}
        contentContainerClassName="pb-6 pt-2"
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
        renderSectionFooter={() => <View className="h-1" />}
      />
    </ScreenTransitionView>
  );
}
