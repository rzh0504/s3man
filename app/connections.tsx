import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { Badge } from '@/components/ui/badge';
import { useConnectionStore } from '@/lib/stores/connection-store';
import * as S3Service from '@/lib/s3-service';
import { PROVIDERS, getProvider, getRegionLabel, buildEndpointUrl } from '@/lib/constants';
import type { S3Config, S3Connection, S3Provider } from '@/lib/types';
import { ProviderIcon } from '@/components/provider-icons';
import {
  EyeIcon,
  EyeOffIcon,
  ChevronDownIcon,
  PlusIcon,
  TrashIcon,
  PencilIcon,
  RefreshCwIcon,
  XIcon,
  WifiIcon,
  WifiOffIcon,
  SearchIcon,
  FolderIcon,
  DownloadIcon,
  ShareIcon,
  ChevronLeftIcon,
} from 'lucide-react-native';

import * as React from 'react';
import {
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

import { useRouter } from 'expo-router';
import { useT } from '@/lib/i18n';

const DEFAULT_CONFIG: S3Config = {
  provider: 'cloudflare-r2',
  endpointUrl: '',
  accessKeyId: '',
  secretAccessKey: '',
  region: 'auto',
  accountId: '',
};

// ── Connection Card ──────────────────────────────────────────────────────

function ConnectionCard({
  conn,
  onEdit,
  onDelete,
  onReconnect,
}: {
  conn: S3Connection;
  onEdit: () => void;
  onDelete: () => void;
  onReconnect: () => void;
}) {
  const providerInfo = getProvider(conn.config.provider);
  const t = useT();

  const statusColor =
    conn.status === 'connected'
      ? 'bg-green-500'
      : conn.status === 'connecting'
        ? 'bg-yellow-500'
        : conn.status === 'error'
          ? 'bg-red-500'
          : 'bg-muted-foreground';

  const statusLabel =
    conn.status === 'connected'
      ? t('conn.connected')
      : conn.status === 'connecting'
        ? t('conn.connecting')
        : conn.status === 'error'
          ? t('conn.statusError')
          : t('conn.statusOffline');

  return (
    <View className="border-border bg-card rounded-xl border p-4">
      <View className="flex-row items-center gap-3">
        <ProviderIcon provider={conn.config.provider} size={28} />
        <View className="flex-1">
          <Text className="text-foreground text-base font-semibold" numberOfLines={1}>
            {conn.displayName}
          </Text>
          <Text className="text-muted-foreground text-xs" numberOfLines={1}>
            {providerInfo.label} · {conn.config.region}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <View className={`h-2 w-2 rounded-full ${statusColor}`} />
          <Text
            className={`text-xs font-medium ${
              conn.status === 'connected'
                ? 'text-green-600'
                : conn.status === 'error'
                  ? 'text-red-500'
                  : 'text-muted-foreground'
            }`}>
            {statusLabel}
          </Text>
        </View>
      </View>

      {conn.status === 'error' && conn.errorMessage ? (
        <View className="bg-destructive/10 mt-2 rounded-md p-2">
          <Text className="text-destructive text-xs" numberOfLines={2}>
            {conn.errorMessage}
          </Text>
        </View>
      ) : null}

      <View className="mt-3 flex-row items-center gap-2">
        {conn.status !== 'connected' && conn.status !== 'connecting' && (
          <Pressable
            onPress={onReconnect}
            className="bg-primary flex-1 flex-row items-center justify-center gap-1.5 rounded-md py-2">
            <Icon as={RefreshCwIcon} className="text-primary-foreground size-3.5" />
            <Text className="text-primary-foreground text-xs font-medium">{t('conn.connect')}</Text>
          </Pressable>
        )}
        {conn.status === 'connecting' && (
          <View className="bg-muted flex-1 flex-row items-center justify-center gap-1.5 rounded-md py-2">
            <ActivityIndicator size="small" />
            <Text className="text-muted-foreground text-xs">{t('conn.connecting')}</Text>
          </View>
        )}
        {conn.status === 'connected' && (
          <View className="bg-muted flex-1 flex-row items-center justify-center gap-1.5 rounded-md py-2">
            <Icon as={WifiIcon} className="size-3.5 text-green-600" />
            <Text className="text-xs font-medium text-green-600">{t('conn.connected')}</Text>
          </View>
        )}
        <Pressable
          onPress={onEdit}
          className="border-border flex-row items-center gap-1.5 rounded-md border px-3 py-2">
          <Icon as={PencilIcon} className="text-muted-foreground size-3.5" />
          <Text className="text-foreground text-xs">{t('edit')}</Text>
        </Pressable>
        <Pressable
          onPress={onDelete}
          className="border-border flex-row items-center gap-1.5 rounded-md border px-3 py-2">
          <Icon as={TrashIcon} className="text-destructive size-3.5" />
        </Pressable>
      </View>
    </View>
  );
}

// ── Export / Import helpers ───────────────────────────────────────────────

import { encryptConfig, decryptConfig } from '@/lib/crypto';

interface ExportPayload {
  version: 2;
  exportedAt: string;
  connections: Array<{
    displayName: string;
    config: S3Config;
  }>;
}

interface EncryptedFile {
  app: 's3man';
  version: 2;
  exportedAt: string;
  data: string; // encrypted base64
}

function buildEncryptedFile(connections: S3Connection[]): EncryptedFile {
  const payload: ExportPayload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    connections: connections.map((c) => ({
      displayName: c.displayName,
      config: c.config,
    })),
  };
  return {
    app: 's3man',
    version: 2,
    exportedAt: payload.exportedAt,
    data: encryptConfig(JSON.stringify(payload)),
  };
}

function parseImportFile(content: string): ExportPayload {
  const file = JSON.parse(content);

  // v2 encrypted format
  if (file && file.app === 's3man' && file.version === 2 && typeof file.data === 'string') {
    const decrypted = decryptConfig(file.data);
    const payload = JSON.parse(decrypted);
    if (!payload || !Array.isArray(payload.connections)) {
      throw new Error('Invalid decrypted config data');
    }
    for (const conn of payload.connections) {
      if (!conn.displayName || !conn.config?.accessKeyId || !conn.config?.secretAccessKey) {
        throw new Error('Config file contains invalid connection entries');
      }
    }
    return payload as ExportPayload;
  }

  // v1 legacy plain JSON format (backward compatible)
  if (file && file.version === 1 && Array.isArray(file.connections)) {
    for (const conn of file.connections) {
      if (!conn.displayName || !conn.config?.accessKeyId || !conn.config?.secretAccessKey) {
        throw new Error('Config file contains invalid connection entries');
      }
    }
    return { ...file, version: 2 } as ExportPayload;
  }

  throw new Error('Invalid config file format');
}

// ── Main Connections Screen ──────────────────────────────────────────────

export default function ConnectionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const { connections, addConnection, updateConnection, removeConnection, connectOne } =
    useConnectionStore();

  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  // Form state
  const [displayName, setDisplayName] = React.useState('');
  const [formConfig, setFormConfig] = React.useState<S3Config>({ ...DEFAULT_CONFIG });
  const [showSecret, setShowSecret] = React.useState(false);
  const [showRegionPicker, setShowRegionPicker] = React.useState(false);
  const [showProviderPicker, setShowProviderPicker] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [formError, setFormError] = React.useState('');

  // Bucket discovery state
  const [discoveredBuckets, setDiscoveredBuckets] = React.useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = React.useState(false);
  const [discoverError, setDiscoverError] = React.useState('');
  const [selectedBuckets, setSelectedBuckets] = React.useState<Set<string>>(new Set());

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = React.useState<S3Connection | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);

  // Export/Import state
  const [isExporting, setIsExporting] = React.useState(false);
  const [isImporting, setIsImporting] = React.useState(false);
  const [importResult, setImportResult] = React.useState<{ text: string; success: boolean } | null>(
    null
  );

  const provider = getProvider(formConfig.provider);

  const resetForm = React.useCallback(() => {
    setDisplayName('');
    setFormConfig({ ...DEFAULT_CONFIG });
    setShowSecret(false);
    setShowRegionPicker(false);
    setShowProviderPicker(false);
    setFormError('');
    setEditingId(null);
    setDiscoveredBuckets([]);
    setDiscoverError('');
    setSelectedBuckets(new Set());
  }, []);

  const openAddForm = React.useCallback(() => {
    resetForm();
    setShowForm(true);
  }, [resetForm]);

  const openEditForm = React.useCallback((conn: S3Connection) => {
    setEditingId(conn.id);
    setDisplayName(conn.displayName);
    setFormConfig({ ...conn.config });
    setShowForm(true);
    setFormError('');
    // Restore previously selected buckets
    setSelectedBuckets(new Set(conn.config.visibleBuckets ?? []));
    setDiscoveredBuckets([]);
    setDiscoverError('');
  }, []);

  const handleCancel = React.useCallback(() => {
    setShowForm(false);
    resetForm();
  }, [resetForm]);

  const handleProviderChange = React.useCallback((key: S3Provider) => {
    const p = getProvider(key);
    setFormConfig((prev) => ({
      ...prev,
      provider: key,
      region: p.defaultRegion,
      endpointUrl: p.defaultEndpoint,
      accountId: '',
      visibleBuckets: undefined,
    }));
    // Auto-fill display name if empty
    setDisplayName((prev) => (prev ? prev : p.label));
    setShowProviderPicker(false);
    // Reset bucket discovery
    setDiscoveredBuckets([]);
    setSelectedBuckets(new Set());
    setDiscoverError('');
  }, []);

  const effectiveEndpoint = React.useMemo(() => {
    if (formConfig.endpointUrl) return formConfig.endpointUrl;
    return buildEndpointUrl(formConfig.provider, formConfig.region, formConfig.accountId);
  }, [formConfig]);

  const connectedCount = connections.filter((c) => c.status === 'connected').length;

  // ── Bucket Discovery ─────────────────────────────────────────────────

  const canDiscover = React.useMemo(() => {
    if (!formConfig.accessKeyId || !formConfig.secretAccessKey) return false;
    if (formConfig.provider === 'cloudflare-r2' && !formConfig.accountId && !formConfig.endpointUrl)
      return false;
    return true;
  }, [formConfig]);

  const handleDiscover = React.useCallback(async () => {
    if (!canDiscover) return;
    setIsDiscovering(true);
    setDiscoverError('');
    try {
      // Trim credentials to avoid "malformed access key id" errors from copy-paste whitespace
      const trimmedConfig = {
        ...formConfig,
        accessKeyId: formConfig.accessKeyId.trim(),
        secretAccessKey: formConfig.secretAccessKey.trim(),
        accountId: formConfig.accountId?.trim(),
        endpointUrl: formConfig.endpointUrl.trim(),
      };
      const bucketNames = await S3Service.discoverBuckets(trimmedConfig);
      setDiscoveredBuckets(bucketNames);
      // If editing and visibleBuckets was set, keep those selections;
      // otherwise pre-select all discovered buckets
      if (selectedBuckets.size === 0) {
        setSelectedBuckets(new Set(bucketNames));
      }
    } catch (error: any) {
      setDiscoverError(error.message || t('form.discoverFailed'));
      setDiscoveredBuckets([]);
    } finally {
      setIsDiscovering(false);
    }
  }, [canDiscover, formConfig, selectedBuckets.size]);

  const toggleBucket = React.useCallback((name: string) => {
    setSelectedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const selectAllBuckets = React.useCallback(() => {
    setSelectedBuckets(new Set(discoveredBuckets));
  }, [discoveredBuckets]);

  const deselectAllBuckets = React.useCallback(() => {
    setSelectedBuckets(new Set());
  }, []);

  const handleSave = async () => {
    if (!formConfig.accessKeyId || !formConfig.secretAccessKey) {
      setFormError(t('form.validationKeys'));
      return;
    }
    if (
      formConfig.provider === 'cloudflare-r2' &&
      !formConfig.accountId &&
      !formConfig.endpointUrl
    ) {
      setFormError(t('form.validationAccountId'));
      return;
    }
    const name = displayName.trim() || provider.label;

    // Trim all credential fields to avoid whitespace issues
    const trimmedConfig: S3Config = {
      ...formConfig,
      accessKeyId: formConfig.accessKeyId.trim(),
      secretAccessKey: formConfig.secretAccessKey.trim(),
      accountId: formConfig.accountId?.trim(),
      endpointUrl: formConfig.endpointUrl.trim(),
      proxyUrl: formConfig.proxyUrl?.trim() || undefined,
      proxyToken: formConfig.proxyToken?.trim() || undefined,
      proxyAlias:
        formConfig.proxyAlias
          ?.trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '') || undefined,
    };

    // Include visible buckets selection if user has discovered buckets
    const configToSave: S3Config = {
      ...trimmedConfig,
      visibleBuckets:
        discoveredBuckets.length > 0 && selectedBuckets.size < discoveredBuckets.length
          ? Array.from(selectedBuckets)
          : undefined, // undefined = show all
    };

    setIsSaving(true);
    setFormError('');
    try {
      if (editingId) {
        await updateConnection(editingId, name, configToSave);
      } else {
        await addConnection(name, configToSave);
      }
      setShowForm(false);
      resetForm();
    } catch (error: any) {
      setFormError(error.message || t('form.connectionFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = React.useCallback((conn: S3Connection) => {
    setDeleteTarget(conn);
    setShowDeleteDialog(true);
  }, []);

  const confirmDelete = React.useCallback(() => {
    if (deleteTarget) {
      removeConnection(deleteTarget.id);
    }
    setShowDeleteDialog(false);
    setDeleteTarget(null);
  }, [deleteTarget, removeConnection]);

  // ── Export / Import ────────────────────────────────────────────────────

  const handleExportFile = React.useCallback(async () => {
    if (connections.length === 0) return;
    setIsExporting(true);
    try {
      const encrypted = buildEncryptedFile(connections);
      const json = JSON.stringify(encrypted);
      const fileName = `s3man-config-${new Date().toISOString().slice(0, 10)}.s3man`;
      const fileUri = FileSystem.cacheDirectory + fileName;
      await FileSystem.writeAsStringAsync(fileUri, json);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/octet-stream',
          dialogTitle: 'Export S3Man Config',
        });
      } else {
        Alert.alert(t('data.shareUnavailable'), t('data.shareUnavailableDesc'));
      }
    } catch (error: any) {
      Alert.alert(t('data.exportFailed'), error.message || t('data.exportFailedDesc'));
    } finally {
      setIsExporting(false);
    }
  }, [connections]);

  const handleImportFile = React.useCallback(async () => {
    setIsImporting(true);
    setImportResult(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) {
        setIsImporting(false);
        return;
      }
      const fileUri = result.assets[0].uri;
      const response = await fetch(fileUri);
      const content = await response.text();
      const payload = parseImportFile(content);
      let imported = 0;
      for (const entry of payload.connections) {
        try {
          await addConnection(entry.displayName, entry.config);
          imported++;
        } catch {
          // skip connections that fail to validate/connect
        }
      }
      setImportResult(
        imported > 0
          ? { text: t('data.importSuccess', { count: imported }), success: true }
          : { text: t('data.importNone'), success: false }
      );
      setTimeout(() => setImportResult(null), 4000);
    } catch (error: any) {
      setImportResult({ text: error.message || t('data.importFailed'), success: false });
      setTimeout(() => setImportResult(null), 4000);
    } finally {
      setIsImporting(false);
    }
  }, [addConnection]);

  // ── Form View ──────────────────────────────────────────────────────────

  if (showForm) {
    return (
      <KeyboardAvoidingView
        className="bg-background flex-1"
        style={{ paddingTop: insets.top }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          className="flex-1"
          contentContainerClassName="p-6 pb-12"
          keyboardShouldPersistTaps="handled">
          {/* Form Header */}
          <View className="mb-4 flex-row items-center gap-2.5">
            <Pressable onPress={handleCancel} className="rounded-md p-1">
              <Icon as={XIcon} className="text-foreground size-6" />
            </Pressable>
            <Text className="text-foreground flex-1 text-xl font-bold">
              {editingId ? t('conn.editConnection') : t('conn.newConnection')}
            </Text>
          </View>

          {/* Error Message */}
          {formError ? (
            <View className="bg-destructive/10 mb-4 rounded-lg p-3">
              <Text className="text-destructive text-sm">{formError}</Text>
            </View>
          ) : null}

          {/* Display Name */}
          <View className="mb-4 gap-2">
            <Label>{t('form.displayName')}</Label>
            <Input
              placeholder={t('form.displayNamePlaceholder')}
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="none"
            />
          </View>

          {/* Provider */}
          <View className="mb-4 gap-2">
            <Label>{t('form.provider')}</Label>
            <Pressable
              onPress={() => setShowProviderPicker(!showProviderPicker)}
              className="border-input bg-background dark:bg-input/30 flex-row items-center justify-between rounded-md border px-3 py-2.5">
              <View className="flex-1 flex-row items-center gap-2">
                <ProviderIcon provider={formConfig.provider} size={20} />
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
                      formConfig.provider === p.key ? 'bg-accent' : ''
                    }`}>
                    <ProviderIcon provider={p.key} size={20} />
                    <View className="flex-1">
                      <Text
                        className={`text-sm ${
                          formConfig.provider === p.key
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

          {/* Account ID (R2) */}
          {provider.needsAccountId && (
            <View className="mb-4 gap-2">
              <Label>{t('form.accountId')}</Label>
              <Input
                placeholder="e.g. a1b2c3d4e5f6..."
                value={formConfig.accountId ?? ''}
                onChangeText={(text) => setFormConfig((p) => ({ ...p, accountId: text }))}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text className="text-muted-foreground text-xs">{t('form.accountIdHelp')}</Text>
            </View>
          )}

          {/* Endpoint URL */}
          <View className="mb-4 gap-2">
            <Label>
              Endpoint URL{' '}
              {formConfig.provider !== 'custom' && (
                <Text className="text-muted-foreground text-xs">
                  {t('form.endpointAutoOverride')}
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
                  formConfig.provider === 'cloudflare-r2'
                    ? '<account-id>.r2.cloudflarestorage.com'
                    : formConfig.provider === 'backblaze-b2'
                      ? `s3.${formConfig.region}.backblazeb2.com`
                      : formConfig.provider === 'aws-s3'
                        ? `s3.${formConfig.region}.amazonaws.com`
                        : 'your-endpoint.com'
                }
                value={formConfig.endpointUrl.replace(/^https?:\/\//, '')}
                onChangeText={(text) =>
                  setFormConfig((p) => ({
                    ...p,
                    endpointUrl: text ? (text.includes('://') ? text : `https://${text}`) : '',
                  }))
                }
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {effectiveEndpoint && !formConfig.endpointUrl ? (
              <Text className="text-muted-foreground text-xs">
                {t('form.willUse', { url: effectiveEndpoint })}
              </Text>
            ) : null}
          </View>

          {/* Access Key ID */}
          <View className="mb-4 gap-2">
            <Label>Access Key ID</Label>
            <Input
              placeholder={
                formConfig.provider === 'cloudflare-r2'
                  ? 'R2 Access Key ID'
                  : formConfig.provider === 'backblaze-b2'
                    ? 'B2 Master Application Key ID'
                    : 'AKIAIOSFODNN7EXAMPLE'
              }
              value={formConfig.accessKeyId}
              onChangeText={(text) => setFormConfig((p) => ({ ...p, accessKeyId: text }))}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {formConfig.provider === 'backblaze-b2' && (
              <Text className="text-muted-foreground text-xs">{t('form.b2KeyIdHelp')}</Text>
            )}
          </View>

          {/* Secret Access Key */}
          <View className="mb-4 gap-2">
            <Label>{t('form.secretAccessKey')}</Label>
            <View className="flex-row items-center gap-0">
              <Input
                className="flex-1 rounded-r-none"
                placeholder={
                  formConfig.provider === 'backblaze-b2'
                    ? t('form.b2SecretPlaceholder')
                    : t('form.secretPlaceholder')
                }
                value={formConfig.secretAccessKey}
                onChangeText={(text) => setFormConfig((p) => ({ ...p, secretAccessKey: text }))}
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
            {formConfig.provider === 'backblaze-b2' && (
              <Text className="text-muted-foreground text-xs">{t('form.b2SecretHelp')}</Text>
            )}
          </View>

          {/* Region */}
          <View className="mb-6 gap-2">
            <Label>{t('form.region')}</Label>
            <Pressable
              onPress={() => setShowRegionPicker(!showRegionPicker)}
              className="border-input bg-background dark:bg-input/30 flex-row items-center justify-between rounded-md border px-3 py-2.5">
              <Text className="text-foreground">
                {getRegionLabel(formConfig.region, formConfig.provider)}
              </Text>
              <Icon as={ChevronDownIcon} className="text-muted-foreground size-4" />
            </Pressable>

            {showRegionPicker && (
              <View className="border-input bg-card mt-1 max-h-48 rounded-md border">
                <ScrollView nestedScrollEnabled>
                  {provider.regions.map((region) => (
                    <Pressable
                      key={region.value}
                      onPress={() => {
                        setFormConfig((p) => ({ ...p, region: region.value }));
                        setShowRegionPicker(false);
                      }}
                      className={`px-3 py-2.5 ${
                        formConfig.region === region.value ? 'bg-accent' : ''
                      }`}>
                      <Text
                        className={`text-sm ${
                          formConfig.region === region.value
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

          {/* Path Style (custom provider only) */}
          {formConfig.provider === 'custom' && (
            <View className="mb-6 gap-2">
              <View className="flex-row items-center gap-3">
                <Checkbox
                  checked={formConfig.forcePathStyle !== false}
                  onCheckedChange={(checked) =>
                    setFormConfig((p) => ({ ...p, forcePathStyle: !!checked }))
                  }
                />
                <Pressable
                  onPress={() =>
                    setFormConfig((p) => ({ ...p, forcePathStyle: p.forcePathStyle === false }))
                  }>
                  <Label>{t('form.pathStyle')}</Label>
                </Pressable>
              </View>
              <Text className="text-muted-foreground text-xs">{t('form.pathStyleHelp')}</Text>
            </View>
          )}

          {/* Proxy URL (optional) */}
          <View className="mb-4 gap-2">
            <Label>
              {t('form.proxyUrl')}{' '}
              <Text className="text-muted-foreground text-xs">{t('form.optional')}</Text>
            </Label>
            <Input
              placeholder="https://files.yourdomain.com"
              value={formConfig.proxyUrl ?? ''}
              onChangeText={(text) => setFormConfig((p) => ({ ...p, proxyUrl: text }))}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text className="text-muted-foreground text-xs">{t('form.proxyUrlHelp')}</Text>
          </View>

          {/* Proxy Token (shown when proxy URL is set) */}
          {!!formConfig.proxyUrl && (
            <View className="mb-4 gap-2">
              <Label>{t('form.proxyToken')}</Label>
              <Input
                placeholder={t('form.proxyTokenPlaceholder')}
                value={formConfig.proxyToken ?? ''}
                onChangeText={(text) => setFormConfig((p) => ({ ...p, proxyToken: text }))}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          )}

          {/* Proxy Alias (shown when proxy URL is set) */}
          {!!formConfig.proxyUrl && (
            <View className="mb-6 gap-2">
              <Label>
                {t('form.proxyAlias')}{' '}
                <Text className="text-muted-foreground text-xs">{t('form.optional')}</Text>
              </Label>
              <Input
                placeholder="b2"
                value={formConfig.proxyAlias ?? ''}
                onChangeText={(text) => setFormConfig((p) => ({ ...p, proxyAlias: text }))}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text className="text-muted-foreground text-xs">{t('form.proxyAliasHelp')}</Text>
            </View>
          )}

          {/* Bucket Discovery */}
          <View className="mb-6 gap-3">
            <View className="flex-row items-center justify-between">
              <Label>{t('form.discoverBuckets')}</Label>
              {discoveredBuckets.length > 0 && (
                <Text className="text-muted-foreground text-xs">
                  {t('form.selectedCount', {
                    selected: selectedBuckets.size,
                    total: discoveredBuckets.length,
                  })}
                </Text>
              )}
            </View>

            <Text className="text-muted-foreground -mt-1 text-xs">
              {formConfig.provider === 'backblaze-b2'
                ? t('form.discoverHelpR2')
                : t('form.discoverHelpGeneric')}
            </Text>

            <Button
              variant="outline"
              onPress={handleDiscover}
              disabled={!canDiscover || isDiscovering}
              className="flex-row items-center gap-2">
              {isDiscovering ? (
                <ActivityIndicator size="small" />
              ) : (
                <Icon as={SearchIcon} className="text-foreground size-4" />
              )}
              <Text>{isDiscovering ? t('form.discovering') : t('form.discoverBuckets')}</Text>
            </Button>

            {discoverError ? (
              <View className="bg-destructive/10 rounded-lg p-3">
                <Text className="text-destructive text-sm">{discoverError}</Text>
              </View>
            ) : null}

            {discoveredBuckets.length > 0 && (
              <View className="border-input bg-card rounded-lg border">
                {/* Select / Deselect All */}
                <View className="border-border flex-row items-center justify-between border-b px-3 py-2">
                  <Text className="text-muted-foreground text-xs font-medium">
                    {t('form.discoveredCount', { count: discoveredBuckets.length })}
                  </Text>
                  <View className="flex-row gap-3">
                    <Pressable onPress={selectAllBuckets}>
                      <Text className="text-primary text-xs font-medium">
                        {t('form.selectAll')}
                      </Text>
                    </Pressable>
                    <Pressable onPress={deselectAllBuckets}>
                      <Text className="text-primary text-xs font-medium">
                        {t('form.deselectAll')}
                      </Text>
                    </Pressable>
                  </View>
                </View>

                {/* Bucket List */}
                {discoveredBuckets.map((name, i) => (
                  <Pressable
                    key={name}
                    onPress={() => toggleBucket(name)}
                    className={`flex-row items-center gap-3 px-3 py-2.5 ${
                      i < discoveredBuckets.length - 1 ? 'border-border border-b' : ''
                    }`}>
                    <Checkbox
                      checked={selectedBuckets.has(name)}
                      onCheckedChange={() => toggleBucket(name)}
                    />
                    <Icon as={FolderIcon} className="text-muted-foreground size-4" />
                    <Text className="text-foreground flex-1 text-sm" numberOfLines={1}>
                      {name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <Separator className="mb-6" />

          {/* Save / Cancel */}
          <View className="flex-row gap-3">
            <Button variant="outline" onPress={handleCancel} className="flex-1">
              <Text>{t('cancel')}</Text>
            </Button>
            <Button onPress={handleSave} disabled={isSaving} className="flex-1">
              {isSaving ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text className="text-primary-foreground font-semibold" numberOfLines={1}>
                  {editingId ? t('save') : t('conn.connect')}
                </Text>
              )}
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Connection List View ───────────────────────────────────────────────

  return (
    <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
      {/* Page Header */}
      <View className="px-6 pt-4 pb-3">
        <View className="flex-row items-center gap-2.5">
          <Pressable onPress={() => router.back()} className="active:bg-accent rounded-lg p-1">
            <Icon as={ChevronLeftIcon} className="text-foreground size-6" />
          </Pressable>
          <Text className="text-foreground flex-1 text-xl font-bold">{t('conn.title')}</Text>
          <Badge variant="secondary" className="shrink-0">
            <Text>
              {connectedCount}/{connections.length}
            </Text>
          </Badge>
        </View>
      </View>

      <Separator />

      <ScrollView className="flex-1" contentContainerClassName="px-6 pb-12 pt-3">
        {/* Connection List */}
        {connections.length === 0 ? (
          <View className="border-border bg-card items-center rounded-xl border py-16">
            <Icon as={WifiOffIcon} className="text-muted-foreground mb-3 size-12" />
            <Text className="text-foreground text-base font-medium">{t('conn.noConnections')}</Text>
            <Text className="text-muted-foreground mt-1 text-center text-sm">
              {t('conn.noConnectionsDesc')}
            </Text>
          </View>
        ) : (
          <View className="gap-3">
            {connections.map((conn) => (
              <ConnectionCard
                key={conn.id}
                conn={conn}
                onEdit={() => openEditForm(conn)}
                onDelete={() => handleDelete(conn)}
                onReconnect={() => connectOne(conn.id)}
              />
            ))}
          </View>
        )}

        {/* Add Connection Button */}
        <Button onPress={openAddForm} className="mt-4 w-full flex-row items-center gap-2" size="lg">
          <Icon as={PlusIcon} className="text-primary-foreground size-5" />
          <Text className="text-primary-foreground font-semibold">{t('conn.addConnection')}</Text>
        </Button>

        {/* ── Data Section: Export / Import ──────────────────────────────── */}
        <Separator className="my-6" />

        <View className="mb-4">
          <Text className="text-foreground text-lg font-semibold">{t('data.title')}</Text>
          <Text className="text-muted-foreground mt-1 text-sm">{t('data.desc')}</Text>
          <Text className="text-muted-foreground mt-0.5 text-xs">{t('data.warning')}</Text>
        </View>

        {/* Import result banner */}
        {importResult && (
          <View
            className={`mb-3 rounded-lg p-3 ${
              importResult.success ? 'bg-green-500/10' : 'bg-destructive/10'
            }`}>
            <Text
              className={`text-sm ${importResult.success ? 'text-green-600' : 'text-destructive'}`}>
              {importResult.text}
            </Text>
          </View>
        )}

        {/* Export Button */}
        <View className="mb-3 gap-2">
          <Text className="text-muted-foreground mb-1 text-xs font-medium tracking-wider">
            {t('data.export')}
          </Text>
          <Button
            variant="outline"
            onPress={handleExportFile}
            disabled={connections.length === 0 || isExporting}
            className="flex-row items-center gap-2">
            {isExporting ? (
              <ActivityIndicator size="small" />
            ) : (
              <Icon as={ShareIcon} className="text-foreground size-4" />
            )}
            <Text>{t('data.exportConfig')}</Text>
          </Button>
        </View>

        {/* Import Button */}
        <View className="gap-2">
          <Text className="text-muted-foreground mb-1 text-xs font-medium tracking-wider">
            {t('data.import')}
          </Text>
          <Button
            variant="outline"
            onPress={handleImportFile}
            disabled={isImporting}
            className="flex-row items-center gap-2">
            {isImporting ? (
              <ActivityIndicator size="small" />
            ) : (
              <Icon as={DownloadIcon} className="text-foreground size-4" />
            )}
            <Text>{t('data.importConfig')}</Text>
          </Button>
        </View>
      </ScrollView>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('conn.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('conn.deleteDesc', { name: deleteTarget?.displayName ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onPress={() => {
                setShowDeleteDialog(false);
                setDeleteTarget(null);
              }}>
              <Text>{t('cancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onPress={confirmDelete}>
              <Text>{t('delete')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}
