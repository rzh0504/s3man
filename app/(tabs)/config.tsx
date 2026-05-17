import { Checkbox } from '@/components/ui/checkbox';
import { fadeIn } from '@/components/ui/fade-motion';
import { Icon } from '@/components/ui/icon';
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import { ScreenTransitionView } from '@/components/ui/screen-transition-view';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { Badge } from '@/components/ui/badge';
import { useConnectionStore } from '@/lib/stores/connection-store';
import { useSettingsStore } from '@/lib/stores/settings-store';
import type { TransferConcurrency } from '@/lib/stores/settings-store';
import { useTransferStore } from '@/lib/stores/transfer-store';
import {
  formatDownloadDirectoryLabel,
  getDownloadDirectoryNameFromUri,
} from '@/lib/download-directory';
import { useT } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n';
import {
  ChevronRightIcon,
  ChevronDownIcon,
  SettingsIcon,
  SunIcon,
  MoonIcon,
  WifiIcon,
  LanguagesIcon,
  FolderOpenIcon,
  RotateCcwIcon,
} from 'lucide-react-native';

import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import * as React from 'react';
import { View, ScrollView, Pressable, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { Uniwind, useUniwind } from 'uniwind';
import { useRouter } from 'expo-router';

const TRANSFER_HISTORY_OPTIONS = [1, 3, 7] as const;
const TRANSFER_CONCURRENCY_OPTIONS = [1, 2, 3] as const;
const TRANSFER_HISTORY_LABELS: Record<(typeof TRANSFER_HISTORY_OPTIONS)[number], TranslationKey> = {
  1: 'settings.transferHistory1d',
  3: 'settings.transferHistory3d',
  7: 'settings.transferHistory7d',
};

type SettingsDropdownOption<T extends number> = {
  value: T;
  label: string;
};

function SettingsDropdown<T extends number>({
  value,
  options,
  open,
  width,
  onToggle,
  onSelect,
}: {
  value: string;
  options: SettingsDropdownOption<T>[];
  open: boolean;
  width: number;
  onToggle: () => void;
  onSelect: (value: T) => void;
}) {
  return (
    <View className="relative" style={{ zIndex: open ? 50 : 1 }}>
      <Pressable
        onPress={onToggle}
        className="border-input bg-background active:bg-accent flex-row items-center justify-between gap-2 rounded-lg border px-3 py-2"
        style={{ width }}>
        <Text className="text-foreground text-sm font-medium">{value}</Text>
        <Icon as={ChevronDownIcon} className="text-muted-foreground size-4" />
      </Pressable>
      {open ? (
        <View
          className="border-border bg-popover absolute top-11 right-0 overflow-hidden rounded-lg border shadow-lg shadow-black/10"
          style={{ width, zIndex: 100 }}>
          {options.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => onSelect(option.value)}
              className="active:bg-accent px-3 py-2.5">
              <Text className="text-popover-foreground text-sm font-medium">{option.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SettingsRow({
  label,
  children,
  onPress,
}: {
  label: string;
  children?: React.ReactNode;
  onPress?: () => void;
}) {
  const content = (
    <View className="flex-row items-center gap-3 px-4 py-3.5">
      <View className="min-w-0 flex-1">
        <Text className="text-foreground text-sm font-medium" numberOfLines={1}>
          {label}
        </Text>
      </View>
      {children ? <View className="shrink-0 flex-row items-center gap-2">{children}</View> : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable onPress={onPress} className="active:bg-accent">
      {content}
    </Pressable>
  );
}

export default function ConfigScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useUniwind();
  const t = useT();
  const connections = useConnectionStore((s) => s.connections);
  const pruneTasks = useTransferStore((s) => s.pruneTasks);
  const {
    showThumbnails,
    setShowThumbnails,
    language,
    setLanguage,
    transferHistoryDays,
    setTransferHistoryDays,
    transferConcurrency,
    setTransferConcurrency,
    downloadDirectoryUri,
    downloadDirectoryName,
    setDownloadDirectory,
  } = useSettingsStore();

  const connectedCount = connections.filter((c) => c.status === 'connected').length;
  const appVersion = Constants.expoConfig?.version ?? '1.0.6';
  const [openDropdown, setOpenDropdown] = React.useState<'history' | 'concurrency' | null>(null);

  const themeScale = useSharedValue(1);

  const themeIconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: themeScale.value }],
  }));

  const closeDropdown = React.useCallback(() => {
    setOpenDropdown(null);
  }, []);

  const toggleTheme = React.useCallback(() => {
    closeDropdown();
    themeScale.value = withSequence(
      withTiming(0.65, { duration: 80, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 180, easing: Easing.out(Easing.back(3)) })
    );
    Uniwind.setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [closeDropdown, theme, themeScale]);

  const toggleLanguage = React.useCallback(() => {
    closeDropdown();
    setLanguage(language === 'zh' ? 'en' : 'zh');
  }, [closeDropdown, language, setLanguage]);

  const handleTransferHistoryDaysChange = React.useCallback(
    (value: (typeof TRANSFER_HISTORY_OPTIONS)[number]) => {
      setTransferHistoryDays(value);
      pruneTasks(value);
      setOpenDropdown(null);
    },
    [pruneTasks, setTransferHistoryDays]
  );

  const handleTransferConcurrencyChange = React.useCallback(
    (value: TransferConcurrency) => {
      setTransferConcurrency(value);
      setOpenDropdown(null);
    },
    [setTransferConcurrency]
  );

  const transferHistoryDropdownOptions = React.useMemo(
    () =>
      TRANSFER_HISTORY_OPTIONS.map((value) => ({
        value,
        label: t(TRANSFER_HISTORY_LABELS[value]),
      })),
    [t]
  );

  const transferConcurrencyDropdownOptions = React.useMemo(
    () =>
      TRANSFER_CONCURRENCY_OPTIONS.map((value) => ({
        value,
        label: t('settings.transferConcurrencyCount', { count: value }),
      })),
    [t]
  );

  const downloadDirectoryLabel = React.useMemo(() => {
    const rawLabel = downloadDirectoryName
      ? formatDownloadDirectoryLabel(downloadDirectoryName)
      : downloadDirectoryUri
        ? formatDownloadDirectoryLabel(downloadDirectoryUri)
        : t('settings.downloadDirectoryDefault');

    const parts = rawLabel
      .split(' / ')
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (parts.length > 0 && rawLabel !== t('settings.downloadDirectoryDefault')) {
      return parts[parts.length - 1];
    }

    if (rawLabel.includes('/')) {
      const normalizedParts = rawLabel
        .split('/')
        .map((segment) => segment.trim())
        .filter(Boolean);
      if (normalizedParts.length > 0 && rawLabel !== t('settings.downloadDirectoryDefault')) {
        return normalizedParts[normalizedParts.length - 1];
      }
    }

    return rawLabel;
  }, [downloadDirectoryName, downloadDirectoryUri, t]);

  const handlePickDownloadDirectory = React.useCallback(async () => {
    closeDropdown();
    if (Platform.OS !== 'android') {
      Alert.alert(t('settings.downloadDirectory'), t('settings.downloadDirectoryOtherDesc'));
      return;
    }

    try {
      const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(
        downloadDirectoryUri ?? null
      );

      if (!permissions.granted || !permissions.directoryUri) {
        return;
      }

      setDownloadDirectory({
        uri: permissions.directoryUri,
        name: getDownloadDirectoryNameFromUri(permissions.directoryUri),
      });
    } catch (error: any) {
      Alert.alert(
        t('settings.downloadDirectory'),
        error?.message || t('settings.downloadDirectoryAndroidDesc')
      );
    }
  }, [closeDropdown, downloadDirectoryUri, setDownloadDirectory, t]);

  const handleResetDownloadDirectory = React.useCallback(() => {
    closeDropdown();
    setDownloadDirectory(null);
  }, [closeDropdown, setDownloadDirectory]);

  return (
    <ScreenTransitionView className="bg-background flex-1" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-6 pt-4 pb-3">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-row items-center gap-2.5">
            <Icon as={SettingsIcon} className="text-foreground size-6" />
            <Text className="text-foreground text-xl font-bold">{t('settings.title')}</Text>
          </View>
          <View className="size-9" />
        </View>
      </View>

      <Separator />

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pb-12 pt-3"
        onScrollBeginDrag={closeDropdown}
        keyboardShouldPersistTaps="handled">
        {/* ── Connections ─────────────────────────────────────────────── */}
        <NativeOnlyAnimatedView entering={fadeIn()}>
          <View className="border-border bg-card rounded-xl border">
            <Pressable
              onPress={() => {
                closeDropdown();
                router.push('/connections' as any);
              }}
              className="active:bg-accent flex-row items-center gap-3 rounded-xl px-4 py-3.5">
              <Icon as={WifiIcon} className="text-foreground size-5" />
              <View className="flex-1 flex-row items-center justify-between">
                <Text className="text-foreground text-sm font-medium">
                  {t('settings.connections')}
                </Text>
                <View className="ml-3 flex-row items-center gap-2">
                  <Badge variant="secondary">
                    <Text className="text-xs">
                      {connectedCount}/{connections.length}
                    </Text>
                  </Badge>
                  <Icon as={ChevronRightIcon} className="text-muted-foreground size-4" />
                </View>
              </View>
            </Pressable>
          </View>
        </NativeOnlyAnimatedView>

        {/* ── General ─────────────────────────────────────────────────── */}
        <Separator className="my-6" />

        <View className="mb-4">
          <Text className="text-foreground text-lg font-semibold">{t('settings.general')}</Text>
        </View>

        <NativeOnlyAnimatedView entering={fadeIn(40)}>
          <View className="border-border bg-card rounded-xl border">
            {/* Theme */}
            <View className="flex-row items-center gap-3 px-4 py-3.5">
              <View className="flex-1">
                <Text className="text-foreground text-sm font-medium" numberOfLines={1}>
                  {t('settings.darkMode')}
                </Text>
              </View>
              <Pressable
                onPress={toggleTheme}
                className="active:bg-accent -my-2 -mr-1 rounded-full p-2"
                accessibilityRole="button"
                accessibilityLabel={t('settings.darkMode')}>
                <Animated.View style={themeIconStyle}>
                  <Icon
                    as={theme === 'dark' ? SunIcon : MoonIcon}
                    className="text-muted-foreground size-5"
                  />
                </Animated.View>
              </Pressable>
            </View>

            <Separator />

            {/* Thumbnails */}
            <View className="flex-row items-center gap-3 px-4 py-3.5">
              <Pressable
                onPress={() => {
                  closeDropdown();
                  setShowThumbnails(!showThumbnails);
                }}
                className="active:bg-accent -my-3.5 -ml-1 flex-1 rounded-lg px-1 py-3.5">
                <Text className="text-foreground text-sm font-medium" numberOfLines={1}>
                  {t('settings.thumbnails')}
                </Text>
              </Pressable>
              <Checkbox
                checked={showThumbnails}
                onCheckedChange={(checked) => {
                  closeDropdown();
                  setShowThumbnails(!!checked);
                }}
              />
            </View>

            <Separator />

            {/* Transfer History */}
            <View
              className="flex-row items-center gap-3 px-4 py-3.5"
              style={{ zIndex: openDropdown === 'history' ? 20 : 2 }}>
              <Text className="text-foreground flex-1 text-sm font-medium" numberOfLines={1}>
                {t('settings.transferHistoryDays')}
              </Text>
              <SettingsDropdown
                value={t(TRANSFER_HISTORY_LABELS[transferHistoryDays])}
                options={transferHistoryDropdownOptions}
                open={openDropdown === 'history'}
                width={96}
                onToggle={() =>
                  setOpenDropdown((current) => (current === 'history' ? null : 'history'))
                }
                onSelect={handleTransferHistoryDaysChange}
              />
            </View>

            <Separator />

            <View
              className="flex-row items-center gap-3 px-4 py-3.5"
              style={{ zIndex: openDropdown === 'concurrency' ? 20 : 1 }}>
              <Text className="text-foreground flex-1 text-sm font-medium" numberOfLines={1}>
                {t('settings.transferConcurrency')}
              </Text>
              <SettingsDropdown
                value={t('settings.transferConcurrencyCount', { count: transferConcurrency })}
                options={transferConcurrencyDropdownOptions}
                open={openDropdown === 'concurrency'}
                width={80}
                onToggle={() =>
                  setOpenDropdown((current) => (current === 'concurrency' ? null : 'concurrency'))
                }
                onSelect={handleTransferConcurrencyChange}
              />
            </View>

            <Separator />

            {/* Download Directory */}
            <View className="flex-row items-center gap-3 px-4 py-3.5">
              <View className="min-w-0 flex-1">
                <Text className="text-foreground text-sm font-medium" numberOfLines={1}>
                  {t('settings.downloadDirectory')}
                </Text>
              </View>
              <Text
                numberOfLines={1}
                className="text-muted-foreground max-w-40 flex-1 text-right text-sm">
                {downloadDirectoryLabel}
              </Text>
              {Platform.OS === 'android' ? (
                <View className="shrink-0 flex-row items-center gap-1">
                  <Pressable
                    onPress={handlePickDownloadDirectory}
                    className="active:bg-accent -my-2 rounded-full p-2"
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.chooseDownloadDirectory')}>
                    <Icon as={FolderOpenIcon} className="text-muted-foreground size-5" />
                  </Pressable>
                  {downloadDirectoryUri ? (
                    <Pressable
                      onPress={handleResetDownloadDirectory}
                      className="active:bg-accent -my-2 rounded-full p-2"
                      accessibilityRole="button"
                      accessibilityLabel={t('settings.resetDownloadDirectory')}>
                      <Icon as={RotateCcwIcon} className="text-muted-foreground size-5" />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>

            <Separator />

            <SettingsRow label={t('settings.language')}>
              <Text className="text-muted-foreground text-sm">
                {language === 'zh' ? t('settings.languageZh') : t('settings.languageEn')}
              </Text>
              <Pressable
                onPress={toggleLanguage}
                className="active:bg-accent -my-2 -mr-1 rounded-full p-2"
                accessibilityRole="button"
                accessibilityLabel={t('settings.language')}>
                <Icon as={LanguagesIcon} className="text-muted-foreground size-5" />
              </Pressable>
            </SettingsRow>

            <Separator />

            <SettingsRow label={t('settings.about')}>
              <Text className="text-muted-foreground text-sm">v{appVersion}</Text>
            </SettingsRow>
          </View>
        </NativeOnlyAnimatedView>
      </ScrollView>
    </ScreenTransitionView>
  );
}
