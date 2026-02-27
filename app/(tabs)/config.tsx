import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { Badge } from '@/components/ui/badge';
import { useConnectionStore } from '@/lib/stores/connection-store';
import { PROVIDERS, getProvider, getRegionLabel, buildEndpointUrl } from '@/lib/constants';
import { testConnection } from '@/lib/s3-service';
import type { S3Provider } from '@/lib/types';
import {
  EyeIcon,
  EyeOffIcon,
  ChevronDownIcon,
  CloudIcon,
  HardDriveIcon,
  ServerIcon,
  BoxIcon,
  SettingsIcon,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import * as React from 'react';
import {
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PROVIDER_ICONS: Record<S3Provider, LucideIcon> = {
  'cloudflare-r2': CloudIcon,
  'backblaze-b2': HardDriveIcon,
  'aws-s3': ServerIcon,
  custom: BoxIcon,
};

export default function ConfigScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { config, status, errorMessage, setConfig, setStatus, saveConfig } = useConnectionStore();

  const [showSecret, setShowSecret] = React.useState(false);
  const [showRegionPicker, setShowRegionPicker] = React.useState(false);
  const [showProviderPicker, setShowProviderPicker] = React.useState(false);

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';
  const provider = getProvider(config.provider);

  // When provider changes, reset region & endpoint to provider defaults
  const handleProviderChange = React.useCallback(
    (key: S3Provider) => {
      const p = getProvider(key);
      setConfig({
        provider: key,
        region: p.defaultRegion,
        endpointUrl: p.defaultEndpoint,
        accountId: '',
      });
      setShowProviderPicker(false);
    },
    [setConfig]
  );

  // Compute the effective endpoint for display
  const effectiveEndpoint = React.useMemo(() => {
    if (config.endpointUrl) return config.endpointUrl;
    return buildEndpointUrl(config.provider, config.region, config.accountId);
  }, [config]);

  const handleConnect = async () => {
    if (!config.accessKeyId || !config.secretAccessKey) {
      setStatus('error', 'Please fill in Access Key ID and Secret Access Key');
      return;
    }
    if (config.provider === 'cloudflare-r2' && !config.accountId && !config.endpointUrl) {
      setStatus('error', 'Please enter your Cloudflare Account ID');
      return;
    }

    setStatus('connecting');
    try {
      await testConnection(config);
      await saveConfig();
      setStatus('connected');
      router.replace('/' as any);
    } catch (error: any) {
      setStatus('error', error.message || 'Connection failed');
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ paddingTop: insets.top }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        className="bg-background flex-1"
        contentContainerClassName="p-6 pb-12"
        keyboardShouldPersistTaps="handled">
        {/* Page Header */}
        <View className="mb-4 flex-row items-center gap-2">
          <Icon as={SettingsIcon} className="text-foreground size-6" />
          <Text className="text-foreground text-lg font-semibold">Config</Text>
        </View>

        {/* Status Badge */}
        <View className="mb-6 flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            {isConnected ? (
              <>
                <View className="h-2 w-2 rounded-full bg-green-500" />
                <Text className="text-sm font-medium text-green-600">ONLINE</Text>
              </>
            ) : (
              <>
                <View className="bg-muted-foreground h-2 w-2 rounded-full" />
                <Text className="text-muted-foreground text-sm font-medium">OFFLINE</Text>
              </>
            )}
          </View>
          {isConnected && (
            <View className="flex-row items-center gap-2">
              <Badge variant="secondary">
                <Text>{provider.label}</Text>
              </Badge>
              <Badge variant="outline">
                <Text>{config.region.toUpperCase()}</Text>
              </Badge>
            </View>
          )}
        </View>

        {/* Title */}
        <Text className="text-foreground text-2xl font-bold">Uplink Configuration</Text>
        <Text className="text-muted-foreground mt-1 text-sm">
          Enter your S3-compatible credentials to establish a secure connection.
        </Text>

        <Separator className="my-6" />

        {/* Error Message */}
        {status === 'error' && errorMessage ? (
          <View className="bg-destructive/10 mb-4 rounded-lg p-3">
            <Text className="text-destructive text-sm">{errorMessage}</Text>
          </View>
        ) : null}

        {/* ── Provider Selection ── */}
        <View className="mb-4 gap-2">
          <Label>Provider</Label>
          <Pressable
            onPress={() => setShowProviderPicker(!showProviderPicker)}
            className="border-input bg-background dark:bg-input/30 flex-row items-center justify-between rounded-md border px-3 py-2.5">
            <View className="flex-1 flex-row items-center gap-2">
              <Icon as={PROVIDER_ICONS[config.provider]} className="text-foreground size-5" />
              <View className="flex-1">
                <Text className="text-foreground text-sm font-medium">{provider.label}</Text>
                <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                  {provider.description}
                </Text>
              </View>
            </View>
            <Icon as={ChevronDownIcon} className="text-muted-foreground ml-2 size-4" />
          </Pressable>

          {showProviderPicker && (
            <View className="border-input bg-card mt-1 rounded-md border">
              {PROVIDERS.map((p) => (
                <Pressable
                  key={p.key}
                  onPress={() => handleProviderChange(p.key)}
                  className={`flex-row items-center gap-3 px-3 py-3 ${
                    config.provider === p.key ? 'bg-accent' : ''
                  }`}>
                  <Icon as={PROVIDER_ICONS[p.key]} className="text-foreground size-5" />
                  <View className="flex-1">
                    <Text
                      className={`text-sm ${
                        config.provider === p.key
                          ? 'text-accent-foreground font-medium'
                          : 'text-foreground'
                      }`}>
                      {p.label}
                    </Text>
                    <Text className="text-muted-foreground text-xs">{p.description}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* ── Cloudflare R2: Account ID ── */}
        {provider.needsAccountId && (
          <View className="mb-4 gap-2">
            <Label>Account ID</Label>
            <Input
              placeholder="e.g. a1b2c3d4e5f6..."
              value={config.accountId ?? ''}
              onChangeText={(text) => setConfig({ accountId: text })}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text className="text-muted-foreground text-xs">
              Find in Cloudflare Dashboard → R2 → Overview
            </Text>
          </View>
        )}

        {/* ── Endpoint URL (Custom / Override) ── */}
        <View className="mb-4 gap-2">
          <Label>
            Endpoint URL{' '}
            {config.provider !== 'custom' && (
              <Text className="text-muted-foreground text-xs">
                (auto-detected, override optional)
              </Text>
            )}
          </Label>
          <View className="flex-row items-center gap-0">
            <View className="bg-muted border-input rounded-l-md border border-r-0 px-3 py-2">
              <Text className="text-muted-foreground text-sm">https://</Text>
            </View>
            <Input
              className="flex-1 rounded-l-none"
              placeholder={
                config.provider === 'cloudflare-r2'
                  ? '<account-id>.r2.cloudflarestorage.com'
                  : config.provider === 'backblaze-b2'
                    ? `s3.${config.region}.backblazeb2.com`
                    : config.provider === 'aws-s3'
                      ? `s3.${config.region}.amazonaws.com`
                      : 'your-endpoint.com'
              }
              value={config.endpointUrl.replace(/^https?:\/\//, '')}
              onChangeText={(text) =>
                setConfig({
                  endpointUrl: text ? (text.includes('://') ? text : `https://${text}`) : '',
                })
              }
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          {effectiveEndpoint && !config.endpointUrl ? (
            <Text className="text-muted-foreground text-xs">Will use: {effectiveEndpoint}</Text>
          ) : null}
        </View>

        {/* ── Access Key ID ── */}
        <View className="mb-4 gap-2">
          <Label>Access Key ID</Label>
          <Input
            placeholder={
              config.provider === 'cloudflare-r2'
                ? 'R2 Access Key ID'
                : config.provider === 'backblaze-b2'
                  ? 'B2 Application Key ID'
                  : 'AKIAIOSFODNN7EXAMPLE'
            }
            value={config.accessKeyId}
            onChangeText={(text) => setConfig({ accessKeyId: text })}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* ── Secret Access Key ── */}
        <View className="mb-4 gap-2">
          <Label>Secret Access Key</Label>
          <View className="flex-row items-center gap-0">
            <Input
              className="flex-1 rounded-r-none"
              placeholder={
                config.provider === 'backblaze-b2' ? 'B2 Application Key' : 'Enter your secret key'
              }
              value={config.secretAccessKey}
              onChangeText={(text) => setConfig({ secretAccessKey: text })}
              secureTextEntry={!showSecret}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              onPress={() => setShowSecret(!showSecret)}
              className="bg-muted border-input rounded-r-md border border-l-0 px-3 py-2.5">
              <Icon
                as={showSecret ? EyeOffIcon : EyeIcon}
                className="text-muted-foreground size-5"
              />
            </Pressable>
          </View>
        </View>

        {/* ── Region ── */}
        <View className="mb-6 gap-2">
          <Label>Region</Label>
          <Pressable
            onPress={() => setShowRegionPicker(!showRegionPicker)}
            className="border-input bg-background dark:bg-input/30 flex-row items-center justify-between rounded-md border px-3 py-2.5">
            <Text className="text-foreground">
              {getRegionLabel(config.region, config.provider)}
            </Text>
            <Icon as={ChevronDownIcon} className="text-muted-foreground size-4" />
          </Pressable>
          {config.provider === 'cloudflare-r2' && (
            <Text className="text-muted-foreground text-xs">
              R2 uses "auto" by default for automatic placement.
            </Text>
          )}
          {config.provider === 'backblaze-b2' && (
            <Text className="text-muted-foreground text-xs">
              This also determines the S3 endpoint. Choose the region matching your bucket.
            </Text>
          )}

          {/* Region picker dropdown */}
          {showRegionPicker && (
            <View className="border-input bg-card mt-1 max-h-48 rounded-md border">
              <ScrollView nestedScrollEnabled>
                {provider.regions.map((region) => (
                  <Pressable
                    key={region.value}
                    onPress={() => {
                      setConfig({ region: region.value });
                      setShowRegionPicker(false);
                    }}
                    className={`px-3 py-2.5 ${config.region === region.value ? 'bg-accent' : ''}`}>
                    <Text
                      className={`text-sm ${
                        config.region === region.value
                          ? 'text-accent-foreground font-medium'
                          : 'text-foreground'
                      }`}>
                      {region.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        {/* Connect Button */}
        <Button onPress={handleConnect} disabled={isConnecting} className="w-full" size="lg">
          {isConnecting ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text className="text-primary-foreground font-semibold">Establish Uplink</Text>
          )}
        </Button>

        {/* Footer Links */}
        <View className="mt-6 flex-row items-center justify-center gap-6">
          <Pressable>
            <Text className="text-muted-foreground text-sm underline">Import Profile</Text>
          </Pressable>
          <Pressable>
            <Text className="text-muted-foreground text-sm underline">Help Center</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
