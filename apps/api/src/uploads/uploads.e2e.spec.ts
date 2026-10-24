import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Uploader, memoryResumeStore, type UploadableFile } from '@incident-triage/upload-client';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';

// Runs against a real S3-compatible store: `docker compose up -d storage`, then
// S3_ENDPOINT=http://localhost:9000 pnpm test (see .env.example for the rest).
const enabled = Boolean(process.env.S3_ENDPOINT);
const MiB = 1024 * 1024;

describe.skipIf(!enabled)('uploads against real storage', () => {
  let app: INestApplication;
  let apiUrl: string;
  let s3: S3Client;

  beforeAll(async () => {
    process.env.S3_CREATE_BUCKET = 'true';
    process.env.S3_FORCE_PATH_STYLE = 'true';
    process.env.UPLOAD_PART_SIZE_MB = '5';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0);
    apiUrl = await app.getUrl();
    s3 = app.get(S3Client);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('uploads a 105 MiB file in parts and stores it intact', async () => {
    const file = patternFile(105 * MiB);
    const uploader = new Uploader({ apiUrl, concurrency: 6 });

    const result = await uploader.upload(file);

    expect(result).toMatchObject({ status: 'completed', size: file.size, partCount: 21 });
    expect(await storedHash(s3, result.key)).toBe(await blobHash(file));
  }, 120_000);

  it('resumes after an interruption and skips the parts already stored', async () => {
    const file = patternFile(23 * MiB);
    const resumeStore = memoryResumeStore();
    const controller = new AbortController();

    const first = new Uploader({ apiUrl, concurrency: 1, resumeStore }).upload(file, {
      signal: controller.signal,
      onProgress: (p) => p.uploadedParts === 2 && controller.abort(),
    });
    await expect(first).rejects.toThrow();

    let resumedFrom = -1;
    const result = await new Uploader({ apiUrl, resumeStore }).upload(file, {
      onProgress: (p) => {
        if (resumedFrom < 0) resumedFrom = p.uploadedParts;
      },
    });

    expect(resumedFrom).toBe(2);
    expect(await storedHash(s3, result.key)).toBe(await blobHash(file));
  }, 60_000);

  it('refuses to complete while parts are missing', async () => {
    const upload = await api('POST', '/uploads', { fileName: 'partial.log', size: 12 * MiB });

    const response = await fetch(`${apiUrl}/uploads/${upload.id}/complete`, { method: 'POST' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ missingParts: [1, 2, 3] });
  });

  it('rejects a part whose size does not match the plan', async () => {
    const upload = await api('POST', '/uploads', { fileName: 'short.log', size: 6 * MiB });
    const signed = await api('POST', `/uploads/${upload.id}/parts`, { partNumbers: [1, 2] });
    await fetch(signed.parts[0].url, { method: 'PUT', body: new Uint8Array(1 * MiB) });
    await fetch(signed.parts[1].url, { method: 'PUT', body: new Uint8Array(1 * MiB) });

    const response = await fetch(`${apiUrl}/uploads/${upload.id}/complete`, { method: 'POST' });

    expect(response.status).toBe(422);
  });

  it('stops signing parts once an upload is aborted', async () => {
    const upload = await api('POST', '/uploads', { fileName: 'cancelled.log', size: MiB });

    await new Uploader({ apiUrl }).cancel(upload.id);

    const status = await api('GET', `/uploads/${upload.id}`);
    expect(status).toMatchObject({ status: 'aborted', uploadedParts: [] });
    const sign = await fetch(`${apiUrl}/uploads/${upload.id}/parts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ partNumbers: [1] }),
    });
    expect(sign.status).toBe(409);
  });

  it('rejects files over the size limit', async () => {
    const response = await fetch(`${apiUrl}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'huge.bin', size: 20 * 1024 * 1024 * MiB }),
    });
    expect(response.status).toBe(413);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function api(method: string, path: string, body?: unknown): Promise<any> {
    const response = await fetch(apiUrl + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    expect(response.ok).toBe(true);
    return response.json();
  }
});

/** Non-repeating bytes, so a part written at the wrong offset changes the hash. */
function patternFile(size: number): UploadableFile {
  const bytes = new Uint8Array(size);
  let x = 2463534242;
  for (let i = 0; i < size; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    bytes[i] = x & 0xff;
  }
  return new File([bytes], 'incident-dump.bin', { lastModified: size });
}

async function blobHash(blob: Blob): Promise<string> {
  return createHash('sha256')
    .update(new Uint8Array(await blob.arrayBuffer()))
    .digest('hex');
}

async function storedHash(s3: S3Client, key: string): Promise<string> {
  const object = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET ?? 'incident-attachments', Key: key }));
  return createHash('sha256')
    .update(await object.Body!.transformToByteArray())
    .digest('hex');
}
