import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;
import 'react-native-get-random-values';
import '@/global.css';

import { NAV_THEME } from '@/lib/theme';
import { ThemeProvider } from '@react-navigation/native';
import { PortalHost } from '@rn-primitives/portal';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useUniwind } from 'uniwind';
import { useConnectionStore } from '@/lib/stores/connection-store';
import { useBucketStore } from '@/lib/stores/bucket-store';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { useTransferStore } from '@/lib/stores/transfer-store';
import { useEffect } from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export default function RootLayout() {
  const { theme } = useUniwind();
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const loadCachedBuckets = useBucketStore((s) => s.loadCachedBuckets);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loadTransfers = useTransferStore((s) => s.loadTasks);

  useEffect(() => {
    const bootstrap = async () => {
      await loadSettings();
      await Promise.all([loadCachedBuckets(), loadConnections(), loadTransfers()]);
    };

    void bootstrap();
  }, [loadConnections, loadCachedBuckets, loadSettings, loadTransfers]);

  return (
    <KeyboardProvider>
      <ThemeProvider value={NAV_THEME[(theme ?? 'light') as keyof typeof NAV_THEME]}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
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
    </KeyboardProvider>
  );
}
