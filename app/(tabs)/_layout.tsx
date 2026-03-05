import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Tabs } from 'expo-router';
import { DatabaseIcon, ArrowLeftRightIcon, SettingsIcon } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

// ── Custom Tab Bar ───────────────────────────────────────────────────────

interface TabDef {
  key: string;
  label: string;
  icon: LucideIcon;
}

const TABS: TabDef[] = [
  { key: 'index', label: 'Buckets', icon: DatabaseIcon },
  { key: 'transfers', label: 'Transfers', icon: ArrowLeftRightIcon },
  { key: 'config', label: 'Settings', icon: SettingsIcon },
];

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View className="border-border bg-background border-t" style={{ paddingBottom: insets.bottom }}>
      <View className="flex-row">
        {TABS.map((tab, i) => {
          const isFocused = state.index === i;
          const route = state.routes[i];
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!isFocused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
              className="flex-1 items-center pt-1 pb-1.5">
              {/* Top indicator bar */}
              <View className={`mb-2 h-0.5 w-10 ${isFocused ? 'bg-primary' : 'bg-transparent'}`} />
              <Animated.View
                style={useAnimatedStyle(() => ({
                  transform: [{ scale: withTiming(isFocused ? 1.1 : 1, { duration: 300 }) }],
                  opacity: withTiming(isFocused ? 1 : 0.65, { duration: 300 }),
                }))}>
                <Icon
                  as={tab.icon}
                  className={`size-6 ${isFocused ? 'text-primary' : 'text-muted-foreground'}`}
                />
              </Animated.View>
              <Text
                className={`mt-1 text-xs leading-tight ${
                  isFocused ? 'text-primary font-semibold' : 'text-muted-foreground font-medium'
                }`}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────

export default function TabLayout() {
  return (
    <Tabs tabBar={(props) => <CustomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Buckets' }} />
      <Tabs.Screen name="transfers" options={{ title: 'Transfers' }} />
      <Tabs.Screen name="config" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
