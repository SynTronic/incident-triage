/**
 * Exponential backoff with full jitter: a random wait in [0, base * 2^attempt],
 * capped. Jitter keeps many clients that failed together from retrying together.
 */
export function backoffDelay(attempt: number, baseMs = 500, capMs = 15_000, random = Math.random): number {
  return Math.round(random() * Math.min(capMs, baseMs * 2 ** attempt));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
