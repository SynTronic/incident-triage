# @incident-triage/upload-client

Uploads large files straight to object storage through the API's `/uploads` endpoints: parallel parts, per-part retries with backoff, and resume after a dropped connection or a page reload. No framework dependency, so it runs in Angular, in mobile WebViews and in Node.

```ts
import { Uploader, localStorageResumeStore, xhrTransport } from '@incident-triage/upload-client';

const uploader = new Uploader({
  apiUrl: 'http://localhost:3000',
  resumeStore: localStorageResumeStore(),
  transport: xhrTransport(), // progress inside each part; the default fetch transport reports per part
});

const controller = new AbortController();
const result = await uploader.upload(file, {
  signal: controller.signal, // abort pauses; upload() again with the same file resumes
  onProgress: (p) => console.log(p.uploadedBytes / p.totalBytes),
});
```

`uploader.cancel(id)` discards an upload for good. See [ADR-002](../../docs/adr/0002-direct-to-storage-uploads.md) for the design.
