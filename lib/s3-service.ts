import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
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

let s3Client: S3Client | null = null;
let currentConfig: S3Config | null = null;

/** Resolve the endpoint URL: use explicit override or build from provider/region/accountId */
function resolveEndpoint(config: S3Config): string {
  if (config.endpointUrl) return config.endpointUrl;
  return buildEndpointUrl(config.provider, config.region, config.accountId);
}

export function createS3Client(config: S3Config): S3Client {
  const endpoint = resolveEndpoint(config);

  const clientConfig: S3ClientConfig = {
    // R2 requires region "auto"; B2 uses its own region format; both work fine here
    region: config.provider === 'cloudflare-r2' ? 'auto' : config.region || 'us-east-1',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  };

  if (endpoint) {
    clientConfig.endpoint = endpoint;
  }

  s3Client = new S3Client(clientConfig);
  currentConfig = config;
  return s3Client;
}

export function getS3Client(): S3Client | null {
  return s3Client;
}

export function getCurrentConfig(): S3Config | null {
  return currentConfig;
}

export function destroyS3Client(): void {
  if (s3Client) {
    s3Client.destroy();
    s3Client = null;
    currentConfig = null;
  }
}

export async function testConnection(config: S3Config): Promise<boolean> {
  const client = createS3Client(config);
  try {
    await client.send(new ListBucketsCommand({}));
    return true;
  } catch (error) {
    destroyS3Client();
    throw error;
  }
}

export async function listBuckets(): Promise<BucketInfo[]> {
  const client = getS3Client();
  const config = getCurrentConfig();
  if (!client || !config) throw new Error('S3 client not initialized');

  const provider = getProvider(config.provider);
  const response = await client.send(new ListBucketsCommand({}));
  const buckets: BucketInfo[] = [];

  if (response.Buckets) {
    for (const bucket of response.Buckets) {
      let region: string | undefined;

      // Only query bucket location if the provider supports it (AWS S3 does; R2 and B2 don't)
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
        // For R2/B2 the region comes from the connection config
        region = config.region;
      }

      buckets.push({
        name: bucket.Name ?? '',
        creationDate: bucket.CreationDate?.toISOString(),
        region,
      });
    }
  }

  return buckets;
}

export async function createBucket(name: string, region?: string): Promise<void> {
  const client = getS3Client();
  const config = getCurrentConfig();
  if (!client || !config) throw new Error('S3 client not initialized');

  const params: any = { Bucket: name };

  // Only set LocationConstraint for AWS S3
  if (config.provider === 'aws-s3' && region && region !== 'us-east-1') {
    params.CreateBucketConfiguration = {
      LocationConstraint: region,
    };
  }

  await client.send(new CreateBucketCommand(params));
}

export async function listObjects(
  bucket: string,
  prefix: string = ''
): Promise<S3Object[]> {
  const client = getS3Client();
  if (!client) throw new Error('S3 client not initialized');

  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/',
    })
  );

  const objects: S3Object[] = [];

  // Add folders (common prefixes)
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

  // Add files
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

  return objects;
}

export async function deleteObjects(
  bucket: string,
  keys: string[]
): Promise<void> {
  const client = getS3Client();
  if (!client) throw new Error('S3 client not initialized');

  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: keys.map((Key) => ({ Key })),
      },
    })
  );
}

// Simplified upload for text/JSON based content (used primarily on web)
export async function uploadObject(
  bucket: string,
  key: string,
  body: Uint8Array | string,
  contentType?: string
): Promise<void> {
  const client = getS3Client();
  if (!client) throw new Error('S3 client not initialized');

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function getObjectUrl(bucket: string, key: string): Promise<string> {
  const client = getS3Client();
  const config = getCurrentConfig();
  if (!client || !config) throw new Error('S3 client not initialized');

  const endpoint = resolveEndpoint(config);
  if (endpoint) {
    return `${endpoint}/${bucket}/${key}`;
  }
  return `https://s3.${config.region}.amazonaws.com/${bucket}/${key}`;
}

/** Generate a presigned URL (valid for `expiresIn` seconds, default 1 hour) */
export async function getPresignedUrl(
  bucket: string,
  key: string,
  expiresIn = 3600
): Promise<string> {
  const client = getS3Client();
  if (!client) throw new Error('S3 client not initialized');

  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn });
}

/** Get presigned URL for uploading (PUT) */
export async function getPresignedUploadUrl(
  bucket: string,
  key: string,
  contentType?: string,
  expiresIn = 3600
): Promise<string> {
  const client = getS3Client();
  if (!client) throw new Error('S3 client not initialized');

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn });
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

/** Check if a file is previewable (image or text-like) */
export function isPreviewable(fileName: string): boolean {
  const mime = guessMimeType(fileName);
  return (
    mime.startsWith('image/') ||
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
