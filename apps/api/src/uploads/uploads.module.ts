import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { createS3Client } from './s3.client';
import { STORAGE_CONFIG, storageConfigFromEnv, type StorageConfig } from './storage.config';
import { StorageBootstrap } from './storage.bootstrap';
import { UploadsController } from './uploads.controller';
import { InMemoryUploadsRepository, UploadsRepository } from './uploads.repository';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [UploadsController],
  providers: [
    { provide: STORAGE_CONFIG, useFactory: () => storageConfigFromEnv() },
    { provide: S3Client, useFactory: createS3Client, inject: [STORAGE_CONFIG] },
    { provide: UploadsRepository, useClass: InMemoryUploadsRepository },
    StorageBootstrap,
    UploadsService,
  ],
})
export class UploadsModule {}
