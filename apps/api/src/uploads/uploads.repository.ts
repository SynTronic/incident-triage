import { Injectable } from '@nestjs/common';

export type UploadStatus = 'uploading' | 'completed' | 'aborted';

export interface UploadRecord {
  id: string;
  /** Object key in the bucket. */
  key: string;
  /** Multipart upload id issued by S3. Never leaves the server. */
  s3UploadId: string;
  fileName: string;
  contentType: string;
  size: number;
  partSize: number;
  partCount: number;
  status: UploadStatus;
  createdAt: Date;
}

/**
 * Upload metadata. The in-memory implementation keeps the module self-contained
 * until the Postgres layer lands; S3 itself stays the source of truth for which
 * parts are uploaded.
 */
export abstract class UploadsRepository {
  abstract insert(record: UploadRecord): Promise<void>;
  abstract find(id: string): Promise<UploadRecord | undefined>;
  abstract setStatus(id: string, status: UploadStatus): Promise<void>;
}

@Injectable()
export class InMemoryUploadsRepository extends UploadsRepository {
  private readonly records = new Map<string, UploadRecord>();

  async insert(record: UploadRecord): Promise<void> {
    this.records.set(record.id, { ...record });
  }

  async find(id: string): Promise<UploadRecord | undefined> {
    const record = this.records.get(id);
    return record && { ...record };
  }

  async setStatus(id: string, status: UploadStatus): Promise<void> {
    const record = this.records.get(id);
    if (record) record.status = status;
  }
}
