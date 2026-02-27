import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Tabs } from 'expo-router';
import { GridIcon, ArrowLeftRightIcon, SettingsIcon } from 'lucide-react-native';
import { useUniwind } from 'uniwind';
import { THEME } from '@/lib/theme';

export default function TabLayout() {
  const { theme } = useUniwind();
  const colors = THEME[(theme ?? 'light') as keyof typeof THEME];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.foreground,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
        },
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTintColor: colors.foreground,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Index',
          tabBarIcon: ({ color, size }) => <GridIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="transfers"
        options={{
          title: 'Transfers',
          tabBarIcon: ({ color, size }) => <ArrowLeftRightIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="config"
        options={{
          title: 'Config',
          tabBarIcon: ({ color, size }) => <SettingsIcon color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
