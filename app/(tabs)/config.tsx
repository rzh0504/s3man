import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import { ScreenTransitionView } from '@/components/ui/screen-transition-view';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { Badge } from '@/components/ui/badge';
import { useConnectionStore } from '@/lib/stores/connection-store';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { useTransferStore } from '@/lib/stores/transfer-store';
import { useT } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n';
import {
  ChevronRightIcon,
  SettingsIcon,
  SunIcon,
  MoonIcon,
  WifiIcon,
  LanguagesIcon,
} from 'lucide-react-native';

import * as React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  Easing,
  ReduceMotion,
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
  } = useSettingsStore();

  const connectedCount = connections.filter((c) => c.status === 'connected').length;

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

  return (
    <ScreenTransitionView className="bg-background flex-1" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-6 pt-4 pb-3">
        <View className="flex-row items-center gap-2.5">
          <Icon as={SettingsIcon} className="text-foreground size-6" />
          <Text className="text-foreground text-xl font-bold">{t('settings.title')}</Text>
        </View>
      </View>

      <Separator />

      <ScrollView className="flex-1" contentContainerClassName="px-6 pb-12 pt-3">
        {/* ── Connections ─────────────────────────────────────────────── */}
        <NativeOnlyAnimatedView
          entering={FadeInDown.duration(200).reduceMotion(ReduceMotion.System)}>
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

        <NativeOnlyAnimatedView
          entering={FadeInDown.duration(220).delay(60).reduceMotion(ReduceMotion.System)}>
          <View className="border-border bg-card rounded-xl border">
            {/* Theme */}
            <View className="flex-row items-center gap-3 px-4 py-3.5">
              <View className="flex-1">
                <Text className="text-foreground text-sm font-medium">{t('settings.darkMode')}</Text>
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
                <Text className="text-foreground text-sm font-medium">
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
            <View className="px-4 py-3.5">
              <Text className="text-foreground mb-3 text-sm font-medium">
                {t('settings.transferHistoryDays')}
              </Text>
              <View className="bg-muted flex-row gap-1 rounded-lg p-1">
                {TRANSFER_HISTORY_OPTIONS.map((option) => {
                  const isActive = transferHistoryDays === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => handleTransferHistoryDaysChange(option)}
                      className={`flex-1 items-center justify-center rounded-md px-3 py-2 ${
                        isActive
                          ? 'bg-background border border-transparent shadow-sm shadow-black/5 dark:border-foreground/10 dark:bg-input/30'
                          : ''
                      }`}>
                      <Text
                        className={`text-sm font-medium ${
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

            {/* Language */}
            <View className="flex-row items-center gap-3 px-4 py-3.5">
              <View className="flex-1">
                <Text className="text-foreground text-sm font-medium">{t('settings.language')}</Text>
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
          </View>
        </NativeOnlyAnimatedView>
      </ScrollView>
    </ScreenTransitionView>
  );
}
