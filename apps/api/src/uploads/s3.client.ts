import { S3Client } from '@aws-sdk/client-s3';
import type { StorageConfig } from './storage.config';

export function createS3Client(config: StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined,
    // By default the SDK adds a CRC32 checksum to every request it signs. A
    // presigned part URL would then demand a checksum the browser cannot know
    // in advance, so only send checksums where S3 requires them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
