import { backoffDelay, sleep } from './backoff.js';
import { memoryResumeStore, type ResumeStore } from './resume-store.js';
import { fetchTransport, type PartTransport } from './transport.js';
import type { SignedPartsView, UploadStatusView, UploadView } from './types.js';

/** A `File` in browsers; any Blob with a name elsewhere (e.g. `fs.openAsBlob` in Node). */
export interface UploadableFile extends Blob {
  readonly name: string;
  readonly lastModified?: number;
}

export interface UploaderOptions {
  /** API base URL, e.g. `http://localhost:3000`. */
  apiUrl: string;
  /** Parts in flight at once. */
  concurrency?: number;
  /** Retries per part after the first attempt. */
  maxRetries?: number;
  /** Presigned URLs requested per API call. */
  signBatchSize?: number;
  resumeStore?: ResumeStore;
  transport?: PartTransport;
  fetch?: typeof fetch;
  /** Extra headers for API calls, e.g. auth. */
  headers?: () => Record<string, string>;
  /** Overridable for tests. */
  delay?: (attempt: number) => number;
}

export interface UploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  uploadedParts: number;
  totalParts: number;
  /** True when this run continued an earlier, interrupted upload. */
  resumed: boolean;
}

export interface UploadOptions {
  contentType?: string;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
  /** Called once the server upload exists, before any bytes are sent. */
  onStart?: (upload: UploadView) => void;
}

export class UploadApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Upload API responded ${status}`);
    this.name = 'UploadApiError';
  }
}

export class PartUploadError extends Error {
  constructor(
    readonly partNumber: number,
    readonly status: number | undefined,
    options?: { cause?: unknown },
  ) {
    super(`Part ${partNumber} failed${status ? ` with HTTP ${status}` : ''}`, options);
    this.name = 'PartUploadError';
  }
}

interface SignedUrl {
  url: string;
  expiresAt: number;
}

// Re-sign a little before expiry so a slow part does not start with a dying URL.
const URL_EXPIRY_MARGIN_MS = 30_000;

/**
 * Uploads large files straight to object storage: the API signs, the bytes go
 * from the client to the bucket in parallel parts, each retried on its own.
 */
export class Uploader {
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly signBatchSize: number;
  private readonly resumeStore: ResumeStore;
  private readonly transport: PartTransport;
  private readonly fetch: typeof fetch;
  private readonly delay: (attempt: number) => number;

  constructor(private readonly options: UploaderOptions) {
    this.concurrency = options.concurrency ?? 4;
    this.maxRetries = options.maxRetries ?? 5;
    this.signBatchSize = options.signBatchSize ?? 20;
    this.resumeStore = options.resumeStore ?? memoryResumeStore();
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.transport = options.transport ?? fetchTransport(this.fetch);
    this.delay = options.delay ?? ((attempt) => backoffDelay(attempt));
  }

  async upload(file: UploadableFile, options: UploadOptions = {}): Promise<UploadView> {
    const fingerprint = fileFingerprint(file);
    const { upload, done } = await this.resumeOrCreate(file, fingerprint, options.contentType);
    options.onStart?.(upload);

    // One failed part stops the others; a caller's abort stops everything.
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    const resumed = done.size > 0;
    const partBytes = new Map<number, number>();
    for (const n of done) partBytes.set(n, partSize(upload, n));
    const report = (): void =>
      options.onProgress?.({
        uploadedBytes: sum(partBytes.values()),
        totalBytes: upload.size,
        uploadedParts: done.size,
        totalParts: upload.partCount,
        resumed,
      });
    report();

    const queue: number[] = [];
    for (let n = 1; n <= upload.partCount; n++) if (!done.has(n)) queue.push(n);
    const signer = new UrlSigner(this, upload.id, queue, this.signBatchSize);

    const worker = async (): Promise<void> => {
      for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
        const size = partSize(upload, n);
        await this.uploadPart(file, upload, n, signer, controller.signal, (loaded) => {
          partBytes.set(n, loaded);
          // The finished part is reported below, together with the part count.
          if (loaded < size) report();
        });
        partBytes.set(n, size);
        done.add(n);
        report();
      }
    };

    try {
      const workers = Array.from({ length: Math.min(this.concurrency, queue.length) }, () =>
        worker().catch((error: unknown) => {
          controller.abort(error);
          throw error;
        }),
      );
      const results = await Promise.allSettled(workers);
      // Report the first real failure, not the aborts it caused in other workers.
      const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failure) throw controller.signal.reason ?? failure.reason;

      const completed = await this.api<UploadView>('POST', `/uploads/${upload.id}/complete`);
      this.resumeStore.delete(fingerprint);
      return completed;
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Discards an upload and its stored parts. Uploads paused by an abort signal stay resumable until this is called. */
  async cancel(uploadId: string): Promise<void> {
    await this.api('DELETE', `/uploads/${uploadId}`);
  }

  /** @internal Used by UrlSigner. */
  signParts(uploadId: string, partNumbers: number[]): Promise<SignedPartsView> {
    return this.api<SignedPartsView>('POST', `/uploads/${uploadId}/parts`, { partNumbers });
  }

  private async resumeOrCreate(
    file: UploadableFile,
    fingerprint: string,
    contentType: string | undefined,
  ): Promise<{ upload: UploadView; done: Set<number> }> {
    const previousId = this.resumeStore.get(fingerprint);
    if (previousId) {
      try {
        const status = await this.api<UploadStatusView>('GET', `/uploads/${previousId}`);
        if (status.status === 'uploading' && status.size === file.size) {
          // A part counts only if it has its full length; a torn part is sent again.
          const done = new Set(
            status.uploadedParts.filter((p) => p.size === partSize(status, p.partNumber)).map((p) => p.partNumber),
          );
          return { upload: status, done };
        }
      } catch (error) {
        if (!(error instanceof UploadApiError) || error.status !== 404) throw error;
      }
      this.resumeStore.delete(fingerprint);
    }

    const upload = await this.api<UploadView>('POST', '/uploads', {
      fileName: file.name,
      size: file.size,
      contentType: contentType || file.type || 'application/octet-stream',
    });
    this.resumeStore.set(fingerprint, upload.id);
    return { upload, done: new Set() };
  }

  private async uploadPart(
    file: UploadableFile,
    upload: UploadView,
    partNumber: number,
    signer: UrlSigner,
    signal: AbortSignal,
    onProgress: (loaded: number) => void,
  ): Promise<void> {
    const start = (partNumber - 1) * upload.partSize;
    const body = file.slice(start, Math.min(start + upload.partSize, upload.size));

    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      let status: number | undefined;
      let cause: unknown;
      try {
        const url = await signer.url(partNumber);
        status = await this.transport(url, body, { signal, onProgress });
        if (status >= 200 && status < 300) return;
        // 403 is usually an expired signature: get a fresh URL and try again.
        if (status === 403) signer.forget(partNumber);
        else if (status < 500 && status !== 408 && status !== 429) throw new PartUploadError(partNumber, status);
      } catch (error) {
        if (signal.aborted || error instanceof PartUploadError) throw error;
        if (error instanceof UploadApiError && error.status < 500) throw error;
        cause = error; // Network error: retry.
      }
      onProgress(0);
      if (attempt >= this.maxRetries) throw new PartUploadError(partNumber, status, { cause });
      await sleep(this.delay(attempt), signal);
    }
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetch(this.options.apiUrl.replace(/\/$/, '') + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...this.options.headers?.(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data: unknown = text ? JSON.parse(text) : undefined;
    if (!response.ok) throw new UploadApiError(response.status, data);
    return data as T;
  }
}

/** Fetches presigned URLs in batches, ahead of the workers that need them. */
class UrlSigner {
  private readonly urls = new Map<number, Promise<SignedUrl>>();

  constructor(
    private readonly uploader: Uploader,
    private readonly uploadId: string,
    private readonly queue: readonly number[],
    private readonly batchSize: number,
  ) {}

  async url(partNumber: number): Promise<string> {
    const cached = this.urls.get(partNumber);
    if (cached) {
      const signed = await cached;
      if (signed.expiresAt - URL_EXPIRY_MARGIN_MS > Date.now()) return signed.url;
      this.urls.delete(partNumber);
    }
    // Sign this part plus the next queued parts that have no URL yet.
    const batch = [partNumber, ...this.queue.filter((n) => !this.urls.has(n) && n !== partNumber)].slice(
      0,
      this.batchSize,
    );
    const request = this.uploader.signParts(this.uploadId, batch);
    for (const n of batch) {
      const signed = request.then((view) => {
        const part = view.parts.find((p) => p.partNumber === n);
        if (!part) throw new Error(`API did not sign part ${n}`);
        return { url: part.url, expiresAt: Date.parse(view.expiresAt) };
      });
      // Parts signed ahead may never be awaited; keep their failure from going unhandled.
      signed.catch(() => undefined);
      this.urls.set(n, signed);
    }
    // Do not leave rejected promises cached: the next attempt signs again.
    request.catch(() => batch.forEach((n) => this.urls.delete(n)));
    return (await this.urls.get(partNumber)!).url;
  }

  forget(partNumber: number): void {
    this.urls.delete(partNumber);
  }
}

function partSize(upload: Pick<UploadView, 'size' | 'partSize' | 'partCount'>, partNumber: number): number {
  return partNumber < upload.partCount ? upload.partSize : upload.size - upload.partSize * (upload.partCount - 1);
}

function fileFingerprint(file: UploadableFile): string {
  return `${file.name}|${file.size}|${file.lastModified ?? 0}`;
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
