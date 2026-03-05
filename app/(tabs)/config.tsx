import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { Badge } from '@/components/ui/badge';
import { useConnectionStore } from '@/lib/stores/connection-store';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { ChevronRightIcon, SettingsIcon, SunIcon, MoonIcon, WifiIcon } from 'lucide-react-native';

import * as React from 'react';
import { View, ScrollView, Pressable } from 'react-native';
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

export default function ConfigScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useUniwind();
  const connections = useConnectionStore((s) => s.connections);
  const { showThumbnails, setShowThumbnails } = useSettingsStore();

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

  return (
    <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-6 pt-4 pb-3">
        <View className="flex-row items-center gap-2.5">
          <Icon as={SettingsIcon} className="text-foreground size-6" />
          <Text className="text-foreground text-xl font-bold">Settings</Text>
        </View>
      </View>

      <Separator />

      <ScrollView className="flex-1" contentContainerClassName="px-6 pb-12 pt-3">
        {/* ── Connections ─────────────────────────────────────────────── */}
        <Pressable
          onPress={() => router.push('/connections' as any)}
          className="border-border bg-card active:bg-accent rounded-xl border">
          <View className="flex-row items-center gap-3 px-4 py-3.5">
            <Icon as={WifiIcon} className="text-foreground size-5" />
            <View className="flex-1">
              <Text className="text-foreground text-sm font-medium">Connections</Text>
              <Text className="text-muted-foreground mt-0.5 text-xs">
                Manage S3 storage providers
              </Text>
            </View>
            <Badge variant="secondary">
              <Text className="text-xs">
                {connectedCount}/{connections.length}
              </Text>
            </Badge>
            <Icon as={ChevronRightIcon} className="text-muted-foreground size-4" />
          </View>
        </Pressable>

        {/* ── General ─────────────────────────────────────────────────── */}
        <Separator className="my-6" />

        <View className="mb-4">
          <Text className="text-foreground text-lg font-semibold">General</Text>
        </View>

        <View className="border-border bg-card rounded-xl border">
          {/* Theme */}
          <Pressable
            onPress={toggleTheme}
            className="active:bg-accent flex-row items-center justify-between px-4 py-3.5">
            <View className="mr-4 flex-1">
              <Text className="text-foreground text-sm font-medium">Dark Mode</Text>
              <Text className="text-muted-foreground mt-0.5 text-xs">
                Switch between light and dark theme
              </Text>
            </View>
            <Animated.View style={themeIconStyle}>
              <Icon
                as={theme === 'dark' ? SunIcon : MoonIcon}
                className="text-muted-foreground size-5"
              />
            </Animated.View>
          </Pressable>

          <Separator />

          {/* Thumbnails */}
          <Pressable
            onPress={() => setShowThumbnails(!showThumbnails)}
            className="active:bg-accent flex-row items-center justify-between px-4 py-3.5">
            <View className="mr-4 flex-1">
              <Text className="text-foreground text-sm font-medium">Image Thumbnails</Text>
              <Text className="text-muted-foreground mt-0.5 text-xs">
                Show thumbnail previews for image files
              </Text>
            </View>
            <Checkbox
              checked={showThumbnails}
              onCheckedChange={(checked) => setShowThumbnails(!!checked)}
            />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
