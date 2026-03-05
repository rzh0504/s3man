import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  GetBucketLocationCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3Config, BucketInfo, S3Object } from '@/lib/types';
import { getProvider, buildEndpointUrl } from '@/lib/constants';
import {
  objectListCache,
  presignedUrlCache,
  objectListCacheKey,
  presignedUrlCacheKey,
  invalidateBucketCache,
} from '@/lib/cache';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Strip whitespace AND invisible Unicode chars (zero-width spaces, BOM, etc.) from credentials */
function sanitize(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\s\u00A0\u200B-\u200D\uFEFF\u2060\u180E\u0000-\u001F]/g, '');
}

// ── Multi-client registry ──────────────────────────────────────────────────

interface ClientEntry {
  client: S3Client;
  config: S3Config;
}

const clientMap = new Map<string, ClientEntry>();

/** Resolve the endpoint URL: use explicit override or build from provider/region/accountId */
function resolveEndpoint(config: S3Config): string {
  if (config.endpointUrl) return config.endpointUrl;
  return buildEndpointUrl(config.provider, config.region, config.accountId);
}

/** Create and register an S3 client for a given connection ID */
export function createClientForConnection(connectionId: string, config: S3Config): S3Client {
  // Destroy existing client for this ID if any
  destroyClientForConnection(connectionId);

  const endpoint = resolveEndpoint(config);

  const clientConfig: S3ClientConfig = {
    region: config.provider === 'cloudflare-r2' ? 'auto' : config.region || 'us-east-1',
    credentials: {
      accessKeyId: sanitize(config.accessKeyId),
      secretAccessKey: sanitize(config.secretAccessKey),
    },
    forcePathStyle: true,
  };

  if (endpoint) {
    clientConfig.endpoint = endpoint;
  }

  const client = new S3Client(clientConfig);
  clientMap.set(connectionId, { client, config });
  return client;
}

/** Get a registered client/config for a connection */
export function getClientEntry(connectionId: string): ClientEntry {
  const entry = clientMap.get(connectionId);
  if (!entry) throw new Error(`No S3 client for connection: ${connectionId}`);
  return entry;
}

/** Destroy and unregister a client */
export function destroyClientForConnection(connectionId: string): void {
  const entry = clientMap.get(connectionId);
  if (entry) {
    entry.client.destroy();
    clientMap.delete(connectionId);
  }
}

/** Destroy all clients */
export function destroyAllClients(): void {
  for (const [id] of clientMap) {
    destroyClientForConnection(id);
  }
}

/**
 * Discover buckets using raw credentials (no registered connection needed).
 * Creates a temporary client, lists buckets, then destroys it.
 */
export async function discoverBuckets(config: S3Config): Promise<string[]> {
  const endpoint = resolveEndpoint(config);
  const clientConfig: S3ClientConfig = {
    region: config.provider === 'cloudflare-r2' ? 'auto' : config.region || 'us-east-1',
    credentials: {
      accessKeyId: sanitize(config.accessKeyId),
      secretAccessKey: sanitize(config.secretAccessKey),
    },
    forcePathStyle: true,
  };
  if (endpoint) {
    clientConfig.endpoint = endpoint;
  }

  const client = new S3Client(clientConfig);
  try {
    const response = await client.send(new ListBucketsCommand({}));
    return (response.Buckets ?? []).map((b) => b.Name ?? '').filter(Boolean);
  } finally {
    client.destroy();
  }
}

// ── Connection-level operations ────────────────────────────────────────────

/** Test connectivity for a given connection ID (client must already be created) */
export async function testConnectionById(connectionId: string): Promise<boolean> {
  const { client } = getClientEntry(connectionId);
  await client.send(new ListBucketsCommand({}));
  return true;
}

export async function listBuckets(connectionId: string): Promise<BucketInfo[]> {
  const { client, config } = getClientEntry(connectionId);
  const provider = getProvider(config.provider);
  const response = await client.send(new ListBucketsCommand({}));
  const buckets: BucketInfo[] = [];

  if (response.Buckets) {
    for (const bucket of response.Buckets) {
      let region: string | undefined;

      if (provider.supportsBucketLocation) {
        try {
          const locResponse = await client.send(
            new GetBucketLocationCommand({ Bucket: bucket.Name })
          );
          region = locResponse.LocationConstraint || 'us-east-1';
        } catch {
          region = undefined;
        }
      } else {
        region = config.region;
      }

      buckets.push({
        name: bucket.Name ?? '',
        creationDate: bucket.CreationDate?.toISOString(),
        region,
        connectionId,
      });
    }
  }

  return buckets;
}

export async function createBucket(connectionId: string, name: string, region?: string): Promise<void> {
  const { client, config } = getClientEntry(connectionId);

  const params: any = { Bucket: name };

  if (config.provider === 'aws-s3' && region && region !== 'us-east-1') {
    params.CreateBucketConfiguration = {
      LocationConstraint: region,
    };
  }

  await client.send(new CreateBucketCommand(params));
}

export async function deleteBucket(connectionId: string, name: string): Promise<void> {
  const { client, config } = getClientEntry(connectionId);

  // B2: purge all hidden versions/delete markers before deleting the bucket
  if (config.provider === 'backblaze-b2') {
    await _deleteAllVersionsWithPrefix(client, name, '');
  }

  await client.send(new DeleteBucketCommand({ Bucket: name }));
}

export async function listObjects(
  connectionId: string,
  bucket: string,
  prefix: string = ''
): Promise<S3Object[]> {
  // Check cache first
  const cacheKey = objectListCacheKey(connectionId, bucket, prefix);
  const cached = objectListCache.get(cacheKey);
  if (cached) return cached;

  const { client } = getClientEntry(connectionId);

  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/',
    })
  );

  const objects: S3Object[] = [];

  if (response.CommonPrefixes) {
    for (const cp of response.CommonPrefixes) {
      if (cp.Prefix) {
        const folderName = cp.Prefix.slice(prefix.length).replace(/\/$/, '');
        objects.push({
          key: cp.Prefix,
          name: folderName + '/',
          isFolder: true,
        });
      }
    }
  }

  if (response.Contents) {
    for (const obj of response.Contents) {
      if (obj.Key && obj.Key !== prefix) {
        const fileName = obj.Key.slice(prefix.length);
        if (fileName) {
          objects.push({
            key: obj.Key,
            name: fileName,
            size: obj.Size,
            lastModified: obj.LastModified?.toISOString(),
            isFolder: false,
          });
        }
      }
    }
  }

  // Cache for 60 seconds
  objectListCache.set(cacheKey, objects, 60);
  return objects;
}

/** Force-refresh listObjects bypassing cache */
export async function listObjectsFresh(
  connectionId: string,
  bucket: string,
  prefix: string = ''
): Promise<S3Object[]> {
  const cacheKey = objectListCacheKey(connectionId, bucket, prefix);
  objectListCache.delete(cacheKey);
  return listObjects(connectionId, bucket, prefix);
}

export async function deleteObjects(
  connectionId: string,
  bucket: string,
  keys: string[]
): Promise<void> {
  const { client, config } = getClientEntry(connectionId);

  if (config.provider === 'backblaze-b2') {
    // B2 creates hidden "delete marker" versions instead of truly deleting.
    // We must list all versions for each key and delete them by VersionId.
    await _deleteAllVersions(client, bucket, keys);
  } else {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: keys.map((Key) => ({ Key })),
        },
      })
    );
  }

  // Invalidate object list cache for this bucket after deletion
  invalidateBucketCache(connectionId, bucket);
}

export async function uploadObject(
  connectionId: string,
  bucket: string,
  key: string,
  body: Uint8Array | string,
  contentType?: string
): Promise<void> {
  const { client } = getClientEntry(connectionId);

  const contentLength = typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: contentLength,
    })
  );
}

export async function getObjectUrl(connectionId: string, bucket: string, key: string): Promise<string> {
  const { config } = getClientEntry(connectionId);

  const endpoint = resolveEndpoint(config);
  if (endpoint) {
    return `${endpoint}/${bucket}/${key}`;
  }
  return `https://s3.${config.region}.amazonaws.com/${bucket}/${key}`;
}

/** Generate a presigned URL (valid for `expiresIn` seconds, default 1 hour) */
export async function getPresignedUrl(
  connectionId: string,
  bucket: string,
  key: string,
  expiresIn = 3600
): Promise<string> {
  // Check cache — use slightly shorter TTL than the actual URL expiry
  const cacheKey = presignedUrlCacheKey(connectionId, bucket, key);
  const cached = presignedUrlCache.get(cacheKey);
  if (cached) return cached;

  const { client } = getClientEntry(connectionId);
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(client, command, { expiresIn });

  // Cache for 80% of the URL's lifetime (e.g. 1h URL → 48 min cache)
  presignedUrlCache.set(cacheKey, url, Math.floor(expiresIn * 0.8));
  return url;
}

/**
 * Batch-generate presigned URLs in parallel.
 * Returns a map of objectKey → presigned URL.
 * Uses the cache so repeated calls are fast.
 */
export async function batchGetPresignedUrls(
  connectionId: string,
  bucket: string,
  keys: string[],
  expiresIn = 1800
): Promise<Record<string, string>> {
  const CONCURRENCY = 6;
  const result: Record<string, string> = {};

  // Fill from cache first; collect uncached keys
  const uncached: string[] = [];
  for (const key of keys) {
    const cacheKey = presignedUrlCacheKey(connectionId, bucket, key);
    const cached = presignedUrlCache.get(cacheKey);
    if (cached) {
      result[key] = cached;
    } else {
      uncached.push(key);
    }
  }

  // Generate remaining in batches of CONCURRENCY
  for (let i = 0; i < uncached.length; i += CONCURRENCY) {
    const batch = uncached.slice(i, i + CONCURRENCY);
    const urls = await Promise.allSettled(
      batch.map((k) => getPresignedUrl(connectionId, bucket, k, expiresIn))
    );
    urls.forEach((settled, idx) => {
      if (settled.status === 'fulfilled') {
        result[batch[idx]] = settled.value;
      }
    });
  }

  return result;
}

/** Get presigned URL for uploading (PUT) */
export async function getPresignedUploadUrl(
  connectionId: string,
  bucket: string,
  key: string,
  contentType?: string,
  expiresIn = 3600
): Promise<string> {
  const { client } = getClientEntry(connectionId);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Build the base64url-encoded S3 config query param for the proxy.
 * This embeds S3 credentials in the URL so Image/Video components can use it directly.
 */
function buildProxyS3CfgParam(config: S3Config): string {
  const cfg = {
    e: resolveEndpoint(config),
    r: config.region,
    a: config.accessKeyId,
    s: config.secretAccessKey,
  };
  // Base64url encode (no padding, URL-safe chars)
  const b64 = btoa(JSON.stringify(cfg))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return b64;
}

/**
 * Build a proxy URL for a given bucket + key.
 * Used for app-internal requests (Image/Video components, fetch).
 */
function buildProxyUrl(config: S3Config, bucket: string, key: string): string {
  const base = config.proxyUrl!.replace(/\/+$/, '');
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const params = new URLSearchParams();
  if (config.proxyToken) params.set('token', config.proxyToken);
  params.set('s3cfg', buildProxyS3CfgParam(config));
  return `${base}/${encodeURIComponent(bucket)}/${encodedKey}?${params.toString()}`;
}

/**
 * Build a clean share URL: /{alias}/{bucket}/{key} — no credentials, no token.
 */
function buildCleanShareUrl(config: S3Config, bucket: string, key: string): string {
  const base = config.proxyUrl!.replace(/\/+$/, '');
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `${base}/${encodeURIComponent(config.proxyAlias!)}/${encodeURIComponent(bucket)}/${encodedKey}`;
}

/**
 * Get a file URL — uses proxy if configured, otherwise falls back to presigned URL.
 * For app-internal read-only access (preview, download).
 */
export async function getFileUrl(
  connectionId: string,
  bucket: string,
  key: string,
  expiresIn = 3600
): Promise<string> {
  const { config } = getClientEntry(connectionId);
  if (config.proxyUrl) {
    return buildProxyUrl(config, bucket, key);
  }
  return getPresignedUrl(connectionId, bucket, key, expiresIn);
}

/**
 * Get headers for proxy requests (fetch/download that support custom headers).
 * Returns null if the connection doesn't use a proxy.
 */
export function getProxyHeaders(connectionId: string): Record<string, string> | null {
  const { config } = getClientEntry(connectionId);
  if (!config.proxyUrl) return null;
  const headers: Record<string, string> = {
    'X-S3-Endpoint': resolveEndpoint(config),
    'X-S3-Region': config.region,
    'X-S3-Access-Key': config.accessKeyId,
    'X-S3-Secret-Key': config.secretAccessKey,
  };
  if (config.proxyToken) {
    headers['Authorization'] = `Bearer ${config.proxyToken}`;
  }
  return headers;
}

/**
 * Batch-generate file URLs (proxy or presigned) in parallel.
 */
export async function batchGetFileUrls(
  connectionId: string,
  bucket: string,
  keys: string[],
  expiresIn = 1800
): Promise<Record<string, string>> {
  const { config } = getClientEntry(connectionId);
  if (config.proxyUrl) {
    const result: Record<string, string> = {};
    for (const key of keys) {
      result[key] = buildProxyUrl(config, bucket, key);
    }
    return result;
  }
  return batchGetPresignedUrls(connectionId, bucket, keys, expiresIn);
}

/**
 * Get a shareable URL — clean proxy URL (no credentials) if alias is configured,
 * otherwise falls back to presigned URL.
 */
export async function getShareUrl(
  connectionId: string,
  bucket: string,
  key: string,
  expiresIn = 3600
): Promise<string> {
  const { config } = getClientEntry(connectionId);
  if (config.proxyUrl && config.proxyAlias) {
    return buildCleanShareUrl(config, bucket, key);
  }
  return getPresignedUrl(connectionId, bucket, key, expiresIn);
}

/**
 * Register this connection's S3 config in the Worker KV for clean share URLs.
 * Call after saving/updating a connection that has proxyUrl + proxyAlias.
 */
export async function registerProxyAlias(connectionId: string): Promise<void> {
  const { config } = getClientEntry(connectionId);
  if (!config.proxyUrl || !config.proxyAlias || !config.proxyToken) return;
  const base = config.proxyUrl.replace(/\/+$/, '');
  const body = {
    endpoint: resolveEndpoint(config),
    region: config.region,
    accessKey: config.accessKeyId,
    secretKey: config.secretAccessKey,
  };
  const resp = await fetch(
    `${base}/api/configs/${encodeURIComponent(config.proxyAlias)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${config.proxyToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Failed to register proxy alias: ${err}`);
  }
}

/**
 * Remove a proxy alias from Worker KV.
 * Call before deleting a connection that has proxyUrl + proxyAlias.
 */
export async function unregisterProxyAlias(config: S3Config): Promise<void> {
  if (!config.proxyUrl || !config.proxyAlias || !config.proxyToken) return;
  const base = config.proxyUrl.replace(/\/+$/, '');
  await fetch(
    `${base}/api/configs/${encodeURIComponent(config.proxyAlias)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${config.proxyToken}` },
    }
  ).catch(() => {}); // best-effort
}

/** Guess MIME type from file extension */
export function guessMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const mimeMap: Record<string, string> = {
    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    // Video
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    wma: 'audio/x-ms-wma',
    // Text / Code
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    log: 'text/plain',
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    ts: 'text/typescript',
    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // Archive
    zip: 'application/zip',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/** Check if a file is previewable (image, video, or text/code) */
export function isPreviewable(fileName: string): boolean {
  const mime = guessMimeType(fileName);
  return (
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript'
  );
}

/** Check if a file is an image */
export function isImageFile(fileName: string): boolean {
  return guessMimeType(fileName).startsWith('image/');
}

/** Check if a file is an audio file */
export function isAudioFile(fileName: string): boolean {
  return guessMimeType(fileName).startsWith('audio/');
}

/** Check if a file is a video file */
export function isVideoFile(fileName: string): boolean {
  return guessMimeType(fileName).startsWith('video/');
}

/** Check if a file is a code/text file that should be shown with monospace */
export function isCodeFile(fileName: string): boolean {
  const mime = guessMimeType(fileName);
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript'
  );
}

// ── B2 version-aware deletion helpers ──────────────────────────────────────

/**
 * Delete ALL versions (including hidden delete markers) for the given keys.
 * Required for Backblaze B2 which creates hide markers instead of truly deleting.
 */
async function _deleteAllVersions(
  client: S3Client,
  bucket: string,
  keys: string[]
): Promise<void> {
  const toDelete: { Key: string; VersionId: string }[] = [];

  // Collect all versions for each key
  for (const key of keys) {
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;

    do {
      const response = await client.send(
        new ListObjectVersionsCommand({
          Bucket: bucket,
          Prefix: key,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        })
      );

      for (const v of response.Versions ?? []) {
        if (v.Key === key && v.VersionId) {
          toDelete.push({ Key: v.Key, VersionId: v.VersionId });
        }
      }
      for (const dm of response.DeleteMarkers ?? []) {
        if (dm.Key === key && dm.VersionId) {
          toDelete.push({ Key: dm.Key, VersionId: dm.VersionId });
        }
      }

      if (response.IsTruncated) {
        keyMarker = response.NextKeyMarker;
        versionIdMarker = response.NextVersionIdMarker;
      } else {
        break;
      }
    } while (true);
  }

  // Delete in batches of 1000
  for (let i = 0; i < toDelete.length; i += 1000) {
    const batch = toDelete.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch,
        },
      })
    );
  }
}

/**
 * Delete ALL versions (including delete markers) for all objects under a prefix.
 * Used by deleteFolderRecursive for B2.
 */
async function _deleteAllVersionsWithPrefix(
  client: S3Client,
  bucket: string,
  prefix: string
): Promise<void> {
  const toDelete: { Key: string; VersionId: string }[] = [];
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;

  do {
    const response = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: prefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      })
    );

    for (const v of response.Versions ?? []) {
      if (v.Key && v.VersionId) {
        toDelete.push({ Key: v.Key, VersionId: v.VersionId });
      }
    }
    for (const dm of response.DeleteMarkers ?? []) {
      if (dm.Key && dm.VersionId) {
        toDelete.push({ Key: dm.Key, VersionId: dm.VersionId });
      }
    }

    if (response.IsTruncated) {
      keyMarker = response.NextKeyMarker;
      versionIdMarker = response.NextVersionIdMarker;
    } else {
      break;
    }
  } while (true);

  // Delete in batches of 1000
  for (let i = 0; i < toDelete.length; i += 1000) {
    const batch = toDelete.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch,
        },
      })
    );
  }
}

/** Create an empty object (used to create "folders" in S3) */
export async function putEmptyObject(
  connectionId: string,
  bucket: string,
  key: string
): Promise<void> {
  const { client } = getClientEntry(connectionId);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: '',
      ContentType: 'application/x-directory',
      ContentLength: 0,
    })
  );
}

/**
 * Recursively delete a folder and all objects under it.
 * Lists all objects with the folder prefix, then deletes them in batches.
 */
export async function deleteFolderRecursive(
  connectionId: string,
  bucket: string,
  prefix: string
): Promise<void> {
  const { client, config } = getClientEntry(connectionId);

  if (config.provider === 'backblaze-b2') {
    // B2: must delete all versions (including hidden delete markers) under this prefix
    await _deleteAllVersionsWithPrefix(client, bucket, prefix);
    invalidateBucketCache(connectionId, bucket);
    return;
  }

  // List ALL objects under this prefix (no delimiter — get everything recursively)
  let continuationToken: string | undefined;
  const allKeys: string[] = [];

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key) allKeys.push(obj.Key);
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  // Also include the folder marker itself
  if (!allKeys.includes(prefix)) {
    allKeys.push(prefix);
  }

  // Delete in batches of 1000 (S3 limit)
  for (let i = 0; i < allKeys.length; i += 1000) {
    const batch = allKeys.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((Key) => ({ Key })),
        },
      })
    );
  }

  invalidateBucketCache(connectionId, bucket);
}
