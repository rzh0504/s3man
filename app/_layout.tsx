import { Buffer } from 'buffer';
(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
import 'react-native-get-random-values';
import '@/global.css';

import { NAV_THEME } from '@/lib/theme';
import { ThemeProvider } from 'expo-router/react-navigation';
import { PortalHost } from '@rn-primitives/portal';
import { Stack } from 'expo-router';
import { Platform, StatusBar, View } from 'react-native';
import { useUniwind } from 'uniwind';
import { useConnectionStore } from '@/lib/stores/connection-store';
import { useBucketStore } from '@/lib/stores/bucket-store';
import { useObjectStore } from '@/lib/stores/object-store';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { useTransferStore } from '@/lib/stores/transfer-store';
import { useEffect } from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';

const STATUS_BAR_BACKGROUND = {
  light: '#ffffff',
  dark: '#0a0a0a',
} as const;

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export default function RootLayout() {
  const { theme } = useUniwind();
  const resolvedTheme = theme === 'dark' ? 'dark' : 'light';
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const loadCachedBuckets = useBucketStore((s) => s.loadCachedBuckets);
  const prewarmRecentObjects = useObjectStore((s) => s.prewarmRecentObjects);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loadTransfers = useTransferStore((s) => s.loadTasks);

  useEffect(() => {
    const barStyle = resolvedTheme === 'dark' ? 'light-content' : 'dark-content';
    StatusBar.setBarStyle(barStyle, true);

    if (Platform.OS === 'android') {
      StatusBar.setTranslucent(false);
      StatusBar.setBackgroundColor(STATUS_BAR_BACKGROUND[resolvedTheme], true);
    }
  }, [resolvedTheme]);

  useEffect(() => {
    const bootstrap = async () => {
      await loadSettings();
      await Promise.all([loadCachedBuckets(), loadConnections(), loadTransfers()]);
      const connectionIds = useConnectionStore
        .getState()
        .connections.filter((connection) => connection.status === 'connected')
        .map((connection) => connection.id);
      void prewarmRecentObjects(connectionIds);
    };

    void bootstrap();
  }, [loadConnections, loadCachedBuckets, loadSettings, loadTransfers, prewarmRecentObjects]);

  return (
    <KeyboardProvider>
      <View className="bg-background flex-1">
        <ThemeProvider value={NAV_THEME[resolvedTheme]}>
          <StatusBar
            barStyle={resolvedTheme === 'dark' ? 'light-content' : 'dark-content'}
            backgroundColor={STATUS_BAR_BACKGROUND[resolvedTheme]}
            translucent={false}
          />
          <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: 'none' }} />
            <Stack.Screen
              name="connections"
              options={{
                headerShown: false,
                animation: 'fade',
              }}
            />
            <Stack.Screen
              name="bucket/[name]"
              options={{
                headerShown: false,
                animation: 'fade_from_bottom',
              }}
            />
            <Stack.Screen
              name="handle-share"
              options={{
                headerShown: false,
                animation: 'slide_from_bottom',
              }}
            />
          </Stack>
          <PortalHost />
        </ThemeProvider>
      </View>
    </KeyboardProvider>
  );
}
