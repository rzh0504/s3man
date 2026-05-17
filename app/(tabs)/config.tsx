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
import { useTransferStore } from '@/lib/stores/transfer-store';
import { formatDownloadDirectoryLabel, getDownloadDirectoryNameFromUri } from '@/lib/download-directory';
import { useT } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n';
import {
  ChevronRightIcon,
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
const TRANSFER_HISTORY_LABELS: Record<(typeof TRANSFER_HISTORY_OPTIONS)[number], TranslationKey> = {
  1: 'settings.transferHistory1d',
  3: 'settings.transferHistory3d',
  7: 'settings.transferHistory7d',
};

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
    downloadDirectoryUri,
    downloadDirectoryName,
    setDownloadDirectory,
  } = useSettingsStore();

  const connectedCount = connections.filter((c) => c.status === 'connected').length;
  const appVersion = Constants.expoConfig?.version ?? '1.0.6';

  const themeScale = useSharedValue(1);

  const themeIconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: themeScale.value }],
  }));

  const toggleTheme = React.useCallback(() => {
    themeScale.value = withSequence(
      withTiming(0.65, { duration: 80, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 180, easing: Easing.out(Easing.back(3)) })
    );
    Uniwind.setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, themeScale]);

  const toggleLanguage = React.useCallback(() => {
    setLanguage(language === 'zh' ? 'en' : 'zh');
  }, [language, setLanguage]);

  const handleTransferHistoryDaysChange = React.useCallback(
    (value: (typeof TRANSFER_HISTORY_OPTIONS)[number]) => {
      setTransferHistoryDays(value);
      pruneTasks(value);
    },
    [pruneTasks, setTransferHistoryDays]
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
  }, [downloadDirectoryUri, setDownloadDirectory, t]);

  const handleResetDownloadDirectory = React.useCallback(() => {
    setDownloadDirectory(null);
  }, [setDownloadDirectory]);

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

      <ScrollView className="flex-1" contentContainerClassName="px-6 pb-12 pt-3">
        {/* ── Connections ─────────────────────────────────────────────── */}
        <NativeOnlyAnimatedView entering={fadeIn()}>
          <View className="border-border bg-card rounded-xl border">
            <Pressable
              onPress={() => router.push('/connections' as any)}
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
                onPress={() => setShowThumbnails(!showThumbnails)}
                className="active:bg-accent -my-3.5 -ml-1 flex-1 rounded-lg px-1 py-3.5">
                <Text className="text-foreground text-sm font-medium" numberOfLines={1}>
                  {t('settings.thumbnails')}
                </Text>
              </Pressable>
              <Checkbox
                checked={showThumbnails}
                onCheckedChange={(checked) => setShowThumbnails(!!checked)}
              />
            </View>

            <Separator />

            {/* Transfer History */}
            <View className="gap-3 px-4 py-3.5">
              <Text className="text-foreground text-sm font-medium" numberOfLines={1}>
                {t('settings.transferHistoryDays')}
              </Text>
              <View className="bg-muted flex-row gap-1 rounded-lg p-1">
                {TRANSFER_HISTORY_OPTIONS.map((option) => {
                  const isActive = transferHistoryDays === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => handleTransferHistoryDaysChange(option)}
                      className={`flex-1 items-center justify-center rounded-md px-2.5 py-1.5 ${
                        isActive
                          ? 'bg-background border border-transparent shadow-sm shadow-black/5 dark:border-foreground/10 dark:bg-input/30'
                          : ''
                      }`}>
                      <Text
                        className={`text-xs font-medium ${
                          isActive ? 'text-foreground' : 'text-muted-foreground'
                        }`}>
                        {t(TRANSFER_HISTORY_LABELS[option])}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
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

            {/* Language */}
            <View className="flex-row items-center gap-3 px-4 py-3.5">
              <View className="min-w-0 flex-1">
                <Text className="text-foreground text-sm font-medium" numberOfLines={1}>
                  {t('settings.language')}
                </Text>
              </View>
              <View className="flex-row items-center gap-2">
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
              </View>
            </View>

            <Separator />

            {/* About */}
            <View className="flex-row items-center gap-3 px-4 py-3.5">
              <Text className="text-foreground flex-1 text-sm font-medium">{t('settings.about')}</Text>
              <Text className="text-muted-foreground text-sm">v{appVersion}</Text>
            </View>
          </View>
        </NativeOnlyAnimatedView>
      </ScrollView>
    </ScreenTransitionView>
  );
}
