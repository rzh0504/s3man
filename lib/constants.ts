import type { S3Provider } from '@/lib/types';

// ─── Provider definitions ────────────────────────────────────────────────────

export interface ProviderInfo {
  key: S3Provider;
  label: string;
  description: string;
  defaultEndpoint: string;
  defaultRegion: string;
  /** Whether the user needs to supply an Account ID (Cloudflare R2) */
  needsAccountId?: boolean;
  /** Whether GetBucketLocation is supported */
  supportsBucketLocation: boolean;
  regions: readonly { label: string; value: string }[];
}

// ─── Cloudflare R2 ───────────────────────────────────────────────────────────

const R2_REGIONS = [
  { label: 'Automatic (Global)', value: 'auto' },
  { label: 'Western North America (WNAM)', value: 'wnam' },
  { label: 'Eastern North America (ENAM)', value: 'enam' },
  { label: 'Western Europe (WEUR)', value: 'weur' },
  { label: 'Eastern Europe (EEUR)', value: 'eeur' },
  { label: 'Asia Pacific (APAC)', value: 'apac' },
] as const;

const CLOUDFLARE_R2: ProviderInfo = {
  key: 'cloudflare-r2',
  label: 'Cloudflare R2',
  description: 'S3-compatible object storage with zero egress fees',
  defaultEndpoint: '', // will be built from accountId
  defaultRegion: 'auto',
  needsAccountId: true,
  supportsBucketLocation: false,
  regions: R2_REGIONS,
};

// ─── Backblaze B2 ────────────────────────────────────────────────────────────

const B2_REGIONS = [
  { label: 'US West (us-west-004)', value: 'us-west-004' },
  { label: 'US West (us-west-002)', value: 'us-west-002' },
  { label: 'US East (us-east-005)', value: 'us-east-005' },
  { label: 'EU Central (eu-central-003)', value: 'eu-central-003' },
] as const;

const BACKBLAZE_B2: ProviderInfo = {
  key: 'backblaze-b2',
  label: 'Backblaze B2',
  description: 'Affordable cloud object storage with S3 API',
  defaultEndpoint: '', // will be built from region
  defaultRegion: 'us-west-004',
  supportsBucketLocation: false,
  regions: B2_REGIONS,
};

// ─── AWS S3 ──────────────────────────────────────────────────────────────────

const AWS_REGIONS_LIST = [
  { label: 'US East (N. Virginia)', value: 'us-east-1' },
  { label: 'US East (Ohio)', value: 'us-east-2' },
  { label: 'US West (N. California)', value: 'us-west-1' },
  { label: 'US West (Oregon)', value: 'us-west-2' },
  { label: 'EU (Ireland)', value: 'eu-west-1' },
  { label: 'EU (Frankfurt)', value: 'eu-central-1' },
  { label: 'EU (London)', value: 'eu-west-2' },
  { label: 'EU (Paris)', value: 'eu-west-3' },
  { label: 'EU (Stockholm)', value: 'eu-north-1' },
  { label: 'Asia Pacific (Tokyo)', value: 'ap-northeast-1' },
  { label: 'Asia Pacific (Seoul)', value: 'ap-northeast-2' },
  { label: 'Asia Pacific (Singapore)', value: 'ap-southeast-1' },
  { label: 'Asia Pacific (Sydney)', value: 'ap-southeast-2' },
  { label: 'Asia Pacific (Mumbai)', value: 'ap-south-1' },
  { label: 'South America (São Paulo)', value: 'sa-east-1' },
  { label: 'Canada (Central)', value: 'ca-central-1' },
] as const;

const AWS_S3: ProviderInfo = {
  key: 'aws-s3',
  label: 'Amazon S3',
  description: 'AWS Simple Storage Service',
  defaultEndpoint: 'https://s3.us-east-1.amazonaws.com',
  defaultRegion: 'us-east-1',
  supportsBucketLocation: true,
  regions: AWS_REGIONS_LIST,
};

// ─── Custom S3-Compatible ────────────────────────────────────────────────────

const CUSTOM_S3: ProviderInfo = {
  key: 'custom',
  label: 'Custom',
  description: 'MinIO, Wasabi, DigitalOcean Spaces, etc.',
  defaultEndpoint: '',
  defaultRegion: 'us-east-1',
  supportsBucketLocation: false,
  regions: [{ label: 'Default', value: 'us-east-1' }],
};

// ─── Provider registry ───────────────────────────────────────────────────────

export const PROVIDERS: ProviderInfo[] = [
  CLOUDFLARE_R2,
  BACKBLAZE_B2,
  AWS_S3,
  CUSTOM_S3,
];

export function getProvider(key: S3Provider): ProviderInfo {
  return PROVIDERS.find((p) => p.key === key) ?? CUSTOM_S3;
}

/** Build the endpoint URL based on provider & config */
export function buildEndpointUrl(
  provider: S3Provider,
  region: string,
  accountId?: string
): string {
  switch (provider) {
    case 'cloudflare-r2':
      return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '';
    case 'backblaze-b2':
      return `https://s3.${region}.backblazeb2.com`;
    case 'aws-s3':
      return `https://s3.${region}.amazonaws.com`;
    default:
      return '';
  }
}

// Re-export for backward compatibility
export const AWS_REGIONS = AWS_REGIONS_LIST;
export const DEFAULT_ENDPOINT = '';
export const DEFAULT_REGION = 'auto';
export const DEFAULT_PROVIDER: S3Provider = 'cloudflare-r2';

// ─── Utility functions ───────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function getFileExtension(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

export function getRegionLabel(regionValue: string, provider?: S3Provider): string {
  if (!provider) {
    // Search all providers
    for (const p of PROVIDERS) {
      const found = p.regions.find((r) => r.value === regionValue);
      if (found) return found.label;
    }
    return regionValue;
  }
  const prov = getProvider(provider);
  const region = prov.regions.find((r) => r.value === regionValue);
  return region ? region.label : regionValue;
}
