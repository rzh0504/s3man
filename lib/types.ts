// S3 兼容服务提供商
export type S3Provider = 'cloudflare-r2' | 'backblaze-b2' | 'aws-s3' | 'custom';

// S3 连接配置
export interface S3Config {
  provider: S3Provider;
  endpointUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  // Cloudflare R2 specific
  accountId?: string;
}

// 连接状态
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// Bucket 信息
export interface BucketInfo {
  name: string;
  creationDate?: string;
  region?: string;
}

// S3 对象
export interface S3Object {
  key: string;
  name: string;
  size?: number;
  lastModified?: string;
  isFolder: boolean;
}

// 传输类型
export type TransferType = 'upload' | 'download';

// 传输状态
export type TransferStatus = 'pending' | 'active' | 'paused' | 'completed' | 'failed';

// 传输任务
export interface TransferTask {
  id: string;
  fileName: string;
  type: TransferType;
  status: TransferStatus;
  progress: number; // 0-100
  totalBytes: number;
  transferredBytes: number;
  bucket: string;
  key: string;
  localPath?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

// 传输过滤标签
export type TransferFilter = 'all' | 'uploading' | 'downloading' | 'completed';
