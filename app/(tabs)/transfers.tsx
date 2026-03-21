import { Icon } from '@/components/ui/icon';
import { ScreenTransitionView } from '@/components/ui/screen-transition-view';
import { Text } from '@/components/ui/text';
import { Separator } from '@/components/ui/separator';
import { TransferItem } from '@/components/transfer-item';
import { EmptyState } from '@/components/empty-state';
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
import { useTransferStore } from '@/lib/stores/transfer-store';
import type { TransferFilter, TransferTask } from '@/lib/types';
import { ArrowLeftRightIcon, ListIcon, Trash2Icon } from 'lucide-react-native';
import * as React from 'react';
import { View, SectionList, Pressable, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { useI18nStore, useT } from '@/lib/i18n';
import type { Locale, TranslationKey } from '@/lib/i18n';

const TABS: { value: TransferFilter; labelKey: TranslationKey; shortLabelKey: TranslationKey }[] = [
  { value: 'all', labelKey: 'all', shortLabelKey: 'all' },
  { value: 'upload', labelKey: 'transfers.upload', shortLabelKey: 'transfers.upload' },
  { value: 'download', labelKey: 'transfers.download', shortLabelKey: 'transfers.download' },
];

const TIMING_CONFIG = { duration: 180, easing: Easing.out(Easing.quad) };
const TAB_CONTAINER_PADDING = 3;
const TAB_GAP = 4;

type TransferSection = {
  title: string;
  key: string;
  data: TransferTask[];
};

type PendingTransferAction =
  | { type: 'remove'; task: TransferTask }
  | { type: 'clear-history' }
  | null;

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

  return (
    <View className="flex-1">
      <Pressable onPress={onPress} className="items-center justify-center rounded-md py-1.5">
        <Text
          className={`text-sm font-medium ${
            isActive ? 'text-foreground' : 'text-muted-foreground'
          }`}
          numberOfLines={1}>
          {isActive ? label : shortLabel}
        </Text>
      </Pressable>
    </View>
  );
}

export default function TransfersScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const locale = useI18nStore((s) => s.locale);
  const { tasks, filter, setFilter, filteredTasks, pauseTask, resumeTask, cancelTask, removeTask, clearHistory } =
    useTransferStore();
  const [pendingAction, setPendingAction] = React.useState<PendingTransferAction>(null);

  const hasClearableHistory = React.useMemo(
    () => tasks.some((task) => task.status !== 'active' && task.status !== 'pending'),
    [tasks]
  );

  const confirmRemoveTask = React.useCallback(
    (task: TransferTask) => {
      setPendingAction({ type: 'remove', task });
    },
    []
  );

  const confirmClearHistory = React.useCallback(() => {
    setPendingAction({ type: 'clear-history' });
  }, []);

  const handleConfirmAction = React.useCallback(() => {
    if (pendingAction?.type === 'remove') {
      removeTask(pendingAction.task.id);
    } else if (pendingAction?.type === 'clear-history') {
      clearHistory();
    }
    setPendingAction(null);
  }, [pendingAction, removeTask, clearHistory]);

  const confirmationTitle =
    pendingAction?.type === 'remove'
      ? t('transfers.removeConfirmTitle')
      : t('transfers.clearHistoryConfirmTitle');

  const confirmationDescription =
    pendingAction?.type === 'remove'
      ? t('transfers.removeConfirmDesc', { name: pendingAction.task.fileName })
      : t('transfers.clearHistoryConfirmDesc');

  const displayTasks = React.useMemo(() => filteredTasks(), [tasks, filter]);
  const activeTabIndex = React.useMemo(
    () => Math.max(
      0,
      TABS.findIndex((tab) => tab.value === filter)
    ),
    [filter]
  );
  const [tabContainerWidth, setTabContainerWidth] = React.useState(0);
  const indicatorOffset = useSharedValue(0);
  const activeFilterLabel = React.useMemo(
    () => TABS.find((tab) => tab.value === filter)?.labelKey ?? 'all',
    [filter]
  );
  const tabWidth = React.useMemo(() => {
    const innerWidth = tabContainerWidth - TAB_CONTAINER_PADDING * 2 - TAB_GAP * (TABS.length - 1);
    return innerWidth > 0 ? innerWidth / TABS.length : 0;
  }, [tabContainerWidth]);

  React.useEffect(() => {
    if (tabWidth <= 0) return;
    indicatorOffset.value = withTiming(activeTabIndex * (tabWidth + TAB_GAP), TIMING_CONFIG);
  }, [activeTabIndex, indicatorOffset, tabWidth]);

  const handleTabsLayout = React.useCallback((event: LayoutChangeEvent) => {
    setTabContainerWidth(event.nativeEvent.layout.width);
  }, []);

  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: tabWidth > 0 ? 1 : 0,
    width: tabWidth,
    transform: [{ translateX: indicatorOffset.value }],
  }));

  const sections = React.useMemo<TransferSection[]>(() => {
    const sortedTasks = [...displayTasks].sort((a, b) => {
      const aTime = new Date(a.startedAt).getTime();
      const bTime = new Date(b.startedAt).getTime();
      return bTime - aTime;
    });

    if (filter === 'all') {
      const grouped = new Map<string, TransferTask[]>();
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
    }

    const inProgressTasks = sortedTasks.filter((task) => task.status !== 'completed');
    const completedTasks = sortedTasks.filter((task) => task.status === 'completed');
    const nextSections: TransferSection[] = [];

    if (inProgressTasks.length > 0) {
      nextSections.push({
        key: 'in-progress',
        title: t('transfers.inProgress'),
        data: inProgressTasks,
      });
    }

    if (completedTasks.length > 0) {
      nextSections.push({
        key: 'completed-history',
        title: t('transfers.completedHistory'),
        data: completedTasks,
      });
    }

    return nextSections;
  }, [displayTasks, filter, locale, t]);

  const renderItem = React.useCallback(
    ({ item }: { item: TransferTask }) => (
      <View className="mb-3 px-4">
        <TransferItem
          task={item}
          onPause={() => pauseTask(item.id)}
          onResume={() => resumeTask(item.id)}
          onCancel={() => cancelTask(item.id)}
          onRemove={() => confirmRemoveTask(item)}
        />
      </View>
    ),
    [pauseTask, resumeTask, cancelTask, confirmRemoveTask]
  );

  return (
    <ScreenTransitionView className="bg-background flex-1" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-6 pt-4 pb-3">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-row items-center gap-2.5">
            <Icon as={ArrowLeftRightIcon} className="text-foreground size-6" />
            <Text className="text-foreground text-xl font-bold">{t('transfers.title')}</Text>
          </View>
          {hasClearableHistory ? (
            <Pressable
              onPress={confirmClearHistory}
              className="active:bg-accent rounded-full p-2"
              accessibilityRole="button"
              accessibilityLabel={t('transfers.clearHistory')}>
              <Icon as={Trash2Icon} className="text-muted-foreground size-5" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <Separator />

      {/* Filter Tabs */}
      <View
        onLayout={handleTabsLayout}
        className="bg-muted relative mx-4 my-2 rounded-lg"
        style={{ padding: TAB_CONTAINER_PADDING }}>
        <Animated.View
          pointerEvents="none"
          style={[
            indicatorStyle,
            {
              position: 'absolute',
              left: TAB_CONTAINER_PADDING,
              top: TAB_CONTAINER_PADDING,
              bottom: TAB_CONTAINER_PADDING,
            },
          ]}
          className="bg-background dark:border-foreground/10 dark:bg-input/30 rounded-md border border-transparent shadow-sm shadow-black/5"
        />
        <View className="flex-row gap-1">
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
                : t('transfers.noFilteredDesc', { filter: t(activeFilterLabel) })
            }
          />
        }
        renderSectionFooter={() => <View className="h-1" />}
      />

      <AlertDialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmationTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmationDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onPress={() => setPendingAction(null)}>
              <Text>{t('cancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onPress={handleConfirmAction}>
              <Text>{t('delete')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScreenTransitionView>
  );
}
