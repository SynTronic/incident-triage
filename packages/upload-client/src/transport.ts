/**
 * Sends one part to its presigned URL and resolves with the HTTP status.
 * `onProgress` reports bytes sent so far for this part.
 */
export type PartTransport = (
  url: string,
  body: Blob,
  options: { signal: AbortSignal; onProgress: (loaded: number) => void },
) => Promise<number>;

/**
 * Works everywhere `fetch` does (browsers, WebViews, Node). Fetch has no
 * upload progress events, so progress moves once per finished part.
 */
export function fetchTransport(fetchImpl: typeof fetch = globalThis.fetch): PartTransport {
  return async (url, body, { signal, onProgress }) => {
    const response = await fetchImpl(url, { method: 'PUT', body, signal });
    // Drain the body so the connection can be reused.
    await response.arrayBuffer().catch(() => undefined);
    if (response.ok) onProgress(body.size);
    return response.status;
  };
}

/** Browser-only. XHR reports upload progress while a part is in flight. */
export function xhrTransport(): PartTransport {
  return (url, body, { signal, onProgress }) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.upload.onprogress = (event) => onProgress(event.loaded);
      xhr.onload = () => resolve(xhr.status);
      xhr.onerror = () => reject(new TypeError('Network error'));
      xhr.onabort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      if (signal.aborted) return xhr.abort();
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(body);
    });
}
