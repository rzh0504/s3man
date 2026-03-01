import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Tabs } from 'expo-router';
import { DatabaseIcon, ArrowLeftRightIcon, SettingsIcon } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

// ── Custom Tab Bar ───────────────────────────────────────────────────────

interface TabDef {
  key: string;
  label: string;
  icon: LucideIcon;
}

const TABS: TabDef[] = [
  { key: 'index', label: 'Buckets', icon: DatabaseIcon },
  { key: 'transfers', label: 'Transfers', icon: ArrowLeftRightIcon },
  { key: 'config', label: 'Config', icon: SettingsIcon },
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
              className="flex-1 items-center pt-0 pb-1">
              {/* Top indicator bar */}
              <View
                className={`mb-1.5 h-[2px] w-8 ${isFocused ? 'bg-primary' : 'bg-transparent'}`}
              />
              <Icon
                as={tab.icon}
                className={`size-5 ${isFocused ? 'text-primary' : 'text-muted-foreground'}`}
              />
              <Text
                className={`mt-0.5 text-[10px] leading-tight ${
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
      <Tabs.Screen name="config" options={{ title: 'Config' }} />
    </Tabs>
  );
}
