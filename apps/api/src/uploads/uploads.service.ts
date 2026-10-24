import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  NoSuchUpload,
  S3Client,
  UploadPartCommand,
  type Part,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { STORAGE_CONFIG, type StorageConfig } from './storage.config';
import { expectedPartSize, planParts } from './upload-plan';
import type {
  CreateUploadInput,
  SignedPartsView,
  SignPartsInput,
  UploadStatusView,
  UploadView,
} from './uploads.dto';
import { UploadsRepository, type UploadRecord } from './uploads.repository';

/**
 * Direct-to-storage uploads. The API never sees file bytes: it opens an S3
 * multipart upload, hands the client short-lived presigned URLs for each part,
 * and checks the parts before stitching them into one object.
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly s3: S3Client,
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig,
    private readonly repository: UploadsRepository,
  ) {}

  async create(input: CreateUploadInput): Promise<UploadView> {
    if (input.size > this.config.maxUploadSize) {
      throw new PayloadTooLargeException(`File is larger than ${this.config.maxUploadSize} bytes`);
    }
    const plan = planParts(input.size, this.config.preferredPartSize);
    const id = randomUUID();
    const key = objectKey(id, input.fileName, new Date());

    const { UploadId } = await this.s3.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: input.contentType,
        Metadata: { 'upload-id': id },
      }),
    );
    if (!UploadId) throw new Error('S3 did not return an UploadId');

    const record: UploadRecord = {
      id,
      key,
      s3UploadId: UploadId,
      fileName: input.fileName,
      contentType: input.contentType,
      size: input.size,
      ...plan,
      status: 'uploading',
      createdAt: new Date(),
    };
    await this.repository.insert(record);
    return toView(record);
  }

  async signParts(id: string, input: SignPartsInput): Promise<SignedPartsView> {
    const record = await this.findUploading(id);
    const invalid = input.partNumbers.filter((n) => n > record.partCount);
    if (invalid.length > 0) {
      throw new BadRequestException(`Part numbers out of range 1..${record.partCount}: ${invalid.join(', ')}`);
    }

    const expiresIn = this.config.presignTtlSeconds;
    const parts = await Promise.all(
      [...new Set(input.partNumbers)].map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          this.s3,
          new UploadPartCommand({
            Bucket: this.config.bucket,
            Key: record.key,
            UploadId: record.s3UploadId,
            PartNumber: partNumber,
          }),
          { expiresIn },
        ),
      })),
    );
    return { expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(), parts };
  }

  async status(id: string): Promise<UploadStatusView> {
    const record = await this.find(id);
    const parts = record.status === 'uploading' ? await this.listParts(record) : [];
    return {
      ...toView(record),
      uploadedParts: parts.map((p) => ({ partNumber: p.PartNumber!, size: p.Size ?? 0 })),
    };
  }

  async complete(id: string): Promise<UploadView> {
    const record = await this.find(id);
    // Completing twice is safe: a client that lost the first response retries.
    if (record.status === 'completed') return toView(record);
    if (record.status === 'aborted') throw new ConflictException('Upload was aborted');

    // Trust what S3 has stored, not what the client says it uploaded.
    const parts = await this.listParts(record);
    const byNumber = new Map(parts.map((p) => [p.PartNumber!, p]));
    const missing: number[] = [];
    for (let n = 1; n <= record.partCount; n++) {
      const part = byNumber.get(n);
      if (!part) {
        missing.push(n);
      } else if (part.Size !== expectedPartSize(record, record.size, n)) {
        throw new UnprocessableEntityException(
          `Part ${n} has ${part.Size} bytes, expected ${expectedPartSize(record, record.size, n)}`,
        );
      }
    }
    if (missing.length > 0) {
      throw new ConflictException({ message: 'Some parts are not uploaded yet', missingParts: missing });
    }

    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: record.key,
        UploadId: record.s3UploadId,
        MultipartUpload: {
          Parts: Array.from({ length: record.partCount }, (_, i) => ({
            PartNumber: i + 1,
            ETag: byNumber.get(i + 1)!.ETag,
          })),
        },
      }),
    );
    await this.repository.setStatus(id, 'completed');
    return toView({ ...record, status: 'completed' });
  }

  async abort(id: string): Promise<void> {
    const record = await this.find(id);
    if (record.status === 'completed') throw new ConflictException('Upload is already completed');
    if (record.status === 'aborted') return;
    try {
      await this.s3.send(
        new AbortMultipartUploadCommand({ Bucket: this.config.bucket, Key: record.key, UploadId: record.s3UploadId }),
      );
    } catch (error) {
      if (!(error instanceof NoSuchUpload)) throw error;
    }
    await this.repository.setStatus(id, 'aborted');
  }

  private async find(id: string): Promise<UploadRecord> {
    const record = await this.repository.find(id);
    if (!record) throw new NotFoundException(`Upload ${id} not found`);
    return record;
  }

  private async findUploading(id: string): Promise<UploadRecord> {
    const record = await this.find(id);
    if (record.status !== 'uploading') throw new ConflictException(`Upload is ${record.status}`);
    return record;
  }

  private async listParts(record: UploadRecord): Promise<Part[]> {
    const parts: Part[] = [];
    let marker: string | undefined;
    do {
      const page = await this.s3.send(
        new ListPartsCommand({
          Bucket: this.config.bucket,
          Key: record.key,
          UploadId: record.s3UploadId,
          PartNumberMarker: marker,
        }),
      );
      parts.push(...(page.Parts ?? []));
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker);
    return parts;
  }
}

function toView(record: UploadRecord): UploadView {
  const { id, key, fileName, size, partSize, partCount, status } = record;
  return { id, key, fileName, size, partSize, partCount, status };
}

/** `attachments/2026/10/<id>/<safe name>`: unique, sortable by date, still readable. */
function objectKey(id: string, fileName: string, now: Date): string {
  const safeName =
    fileName
      .normalize('NFKC')
      .replace(/[^\w.-]+/g, '_')
      .slice(-200) || 'file';
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `attachments/${now.getUTCFullYear()}/${month}/${id}/${safeName}`;
}
