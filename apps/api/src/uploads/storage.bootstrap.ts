import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { STORAGE_CONFIG, type StorageConfig } from './storage.config';

/**
 * Local development only: creates the bucket and applies the settings that
 * infrastructure code will own in AWS.
 */
@Injectable()
export class StorageBootstrap implements OnModuleInit {
  private readonly logger = new Logger(StorageBootstrap.name);

  constructor(
    private readonly s3: S3Client,
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.createBucket) return;
    const Bucket = this.config.bucket;

    try {
      await this.s3.send(new HeadBucketCommand({ Bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket }));
      this.logger.log(`Created bucket ${Bucket}`);
    }

    // Browsers PUT parts straight to the bucket, so it must allow cross-origin requests.
    await this.bestEffort('CORS', () =>
      this.s3.send(
        new PutBucketCorsCommand({
          Bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: ['*'],
                AllowedMethods: ['PUT', 'GET', 'HEAD'],
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      ),
    );

    // Parts of abandoned uploads are billed until aborted; let S3 clean them up.
    await this.bestEffort('lifecycle', () =>
      this.s3.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: 'abort-incomplete-multipart-uploads',
                Status: 'Enabled',
                Filter: { Prefix: '' },
                AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
              },
            ],
          },
        }),
      ),
    );
  }

  private async bestEffort(what: string, action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.logger.warn(`Could not apply bucket ${what} rules: ${(error as Error).message}`);
    }
  }
}
