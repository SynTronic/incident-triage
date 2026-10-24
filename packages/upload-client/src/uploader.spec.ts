import { describe, expect, it } from 'vitest';
import { memoryResumeStore } from './resume-store.js';
import type { UploadProgress, UploadableFile } from './uploader.js';
import { PartUploadError, Uploader } from './uploader.js';

const PART = 1024;

/** In-memory stand-in for the API and the bucket. */
class FakeBackend {
  uploads = new Map<string, { size: number; parts: Map<number, number>; status: string }>();
  puts: number[] = [];
  signCalls = 0;
  /** Status to answer for the next PUTs of a part, consumed one per request. */
  failures = new Map<number, number[]>();
  /** Called before each PUT is stored; lets a test abort mid-upload. */
  onPut?: (partNumber: number) => void;
  private nextId = 1;

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body;

    if (url.host === 'bucket.test') {
      init?.signal?.throwIfAborted();
      const id = url.searchParams.get('upload')!;
      const n = Number(url.searchParams.get('part'));
      this.puts.push(n);
      this.onPut?.(n);
      init?.signal?.throwIfAborted();
      const failure = this.failures.get(n)?.shift();
      if (failure) return new Response(null, { status: failure });
      this.uploads.get(id)!.parts.set(n, (body as Blob).size);
      return new Response(null, { status: 200 });
    }

    const json = body ? JSON.parse(String(body)) : undefined;
    const [, , id, action] = url.pathname.split('/');
    if (method === 'POST' && !id) {
      const newId = `u${this.nextId++}`;
      this.uploads.set(newId, { size: json.size, parts: new Map(), status: 'uploading' });
      return Response.json(this.view(newId));
    }
    const upload = this.uploads.get(id!);
    if (!upload) return Response.json({ message: 'not found' }, { status: 404 });
    if (method === 'GET') {
      return Response.json({
        ...this.view(id!),
        uploadedParts: [...upload.parts].map(([partNumber, size]) => ({ partNumber, size })),
      });
    }
    if (action === 'parts') {
      this.signCalls++;
      return Response.json({
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        parts: json.partNumbers.map((n: number) => ({
          partNumber: n,
          url: `https://bucket.test/?upload=${id}&part=${n}&sig=${this.signCalls}`,
        })),
      });
    }
    if (action === 'complete') {
      const view = this.view(id!);
      if (upload.parts.size !== view.partCount) return Response.json({ message: 'missing' }, { status: 409 });
      upload.status = 'completed';
      return Response.json(this.view(id!));
    }
    return new Response(null, { status: 405 });
  };

  view(id: string) {
    const upload = this.uploads.get(id)!;
    return {
      id,
      key: `attachments/${id}`,
      fileName: 'dump.bin',
      size: upload.size,
      partSize: PART,
      partCount: Math.ceil(upload.size / PART),
      status: upload.status,
    };
  }
}

function file(size: number): UploadableFile {
  return Object.assign(new Blob([new Uint8Array(size)]), { name: 'dump.bin', lastModified: 1 });
}

function uploader(backend: FakeBackend, overrides: Partial<ConstructorParameters<typeof Uploader>[0]> = {}) {
  return new Uploader({ apiUrl: 'https://api.test', fetch: backend.fetch, delay: () => 0, ...overrides });
}

describe('Uploader', () => {
  it('uploads every part and completes', async () => {
    const backend = new FakeBackend();
    const progress: UploadProgress[] = [];

    const result = await uploader(backend).upload(file(PART * 4 + 10), { onProgress: (p) => progress.push(p) });

    expect(result.status).toBe('completed');
    expect([...backend.puts].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(progress.at(-1)).toMatchObject({ uploadedBytes: PART * 4 + 10, uploadedParts: 5, resumed: false });
  });

  it('signs URLs in batches rather than per part', async () => {
    const backend = new FakeBackend();
    await uploader(backend, { concurrency: 1, signBatchSize: 3 }).upload(file(PART * 6));
    expect(backend.signCalls).toBe(2);
  });

  it('retries a part that failed with a server error', async () => {
    const backend = new FakeBackend();
    backend.failures.set(2, [500, 503]);

    await uploader(backend).upload(file(PART * 3));

    expect(backend.puts.filter((n) => n === 2)).toHaveLength(3);
  });

  it('gets a fresh URL when the old one is rejected as expired', async () => {
    const backend = new FakeBackend();
    backend.failures.set(1, [403]);

    await uploader(backend, { concurrency: 1 }).upload(file(PART * 2));

    expect(backend.signCalls).toBe(2);
  });

  it('gives up after the retry budget', async () => {
    const backend = new FakeBackend();
    backend.failures.set(1, [500, 500, 500]);

    const upload = uploader(backend, { maxRetries: 2 }).upload(file(PART));

    await expect(upload).rejects.toBeInstanceOf(PartUploadError);
    expect(backend.puts).toEqual([1, 1, 1]);
  });

  it('does not retry a client error', async () => {
    const backend = new FakeBackend();
    backend.failures.set(1, [400]);

    await expect(uploader(backend).upload(file(PART))).rejects.toMatchObject({ partNumber: 1, status: 400 });
    expect(backend.puts).toEqual([1]);
  });

  it('resumes an interrupted upload without sending finished parts again', async () => {
    const backend = new FakeBackend();
    const resumeStore = memoryResumeStore();
    const controller = new AbortController();
    backend.onPut = (n) => {
      if (n === 3) controller.abort();
    };

    const first = uploader(backend, { concurrency: 1, resumeStore }).upload(file(PART * 5), {
      signal: controller.signal,
    });
    await expect(first).rejects.toThrow();
    expect(backend.puts).toEqual([1, 2, 3]);

    backend.onPut = undefined;
    backend.puts = [];
    const progress: UploadProgress[] = [];
    const result = await uploader(backend, { concurrency: 1, resumeStore }).upload(file(PART * 5), {
      onProgress: (p) => progress.push(p),
    });

    expect(result.id).toBe('u1');
    expect(backend.puts).toEqual([3, 4, 5]);
    expect(progress[0]).toMatchObject({ uploadedParts: 2, resumed: true });
  });

  it('starts over when the remembered upload is gone', async () => {
    const backend = new FakeBackend();
    const resumeStore = memoryResumeStore();
    resumeStore.set('dump.bin|1024|1', 'missing');

    const result = await uploader(backend, { resumeStore }).upload(file(PART));

    expect(result.id).toBe('u1');
  });
});
