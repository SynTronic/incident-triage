const MiB = 1024 * 1024;

export interface StorageConfig {
  /** Custom endpoint for S3-compatible stores (RustFS locally); unset on AWS. */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Path-style URLs (`host/bucket/key`), which local S3-compatible stores need. */
  forcePathStyle: boolean;
  /** Create the bucket with dev CORS and lifecycle rules on startup. Local only. */
  createBucket: boolean;
  preferredPartSize: number;
  maxUploadSize: number;
  presignTtlSeconds: number;
}

export const STORAGE_CONFIG = Symbol('STORAGE_CONFIG');

export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  return {
    endpoint: env.S3_ENDPOINT || undefined,
    region: env.S3_REGION ?? 'us-east-1',
    bucket: env.S3_BUCKET ?? 'incident-attachments',
    accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    createBucket: env.S3_CREATE_BUCKET === 'true',
    preferredPartSize: Number(env.UPLOAD_PART_SIZE_MB ?? 8) * MiB,
    maxUploadSize: Number(env.UPLOAD_MAX_SIZE_MB ?? 10 * 1024) * MiB,
    presignTtlSeconds: Number(env.UPLOAD_PRESIGN_TTL_SECONDS ?? 15 * 60),
  };
}
