# ADR-002: Large files go straight to object storage in multipart uploads

- **Status:** Accepted
- **Date:** 2026-10-24

## Context

Incidents come with attachments: log archives, heap and core dumps, packet captures. They are often 100 MB to several GB and are uploaded from browsers, from the widget embedded in other products, and from mobile WebViews on flaky networks.

Streaming such files through the API would tie up a Node process and its memory for minutes per upload, make API instances size-bound instead of request-bound, and lose the whole transfer on any dropped connection.

## Decision

Clients upload bytes directly to S3 (or an S3-compatible store) using **S3 multipart upload with presigned part URLs**. The API only coordinates:

| Call | What the API does |
|---|---|
| `POST /uploads` `{fileName, size, contentType}` | Validates the size limit, picks the part size, opens a multipart upload, returns `{id, partSize, partCount}` |
| `POST /uploads/:id/parts` `{partNumbers}` | Returns presigned `PUT` URLs (15 min) for up to 100 parts at once |
| `GET /uploads/:id` | Lists the parts S3 already has, so a client can resume |
| `POST /uploads/:id/complete` | Checks every part is present with the expected size, then completes. Idempotent |
| `DELETE /uploads/:id` | Aborts the upload and frees stored parts |

Details:

- **Part size** is 8 MiB by default and grows so that any file fits in S3's 10,000-part limit (`planParts`). The server decides it, so every client cuts files the same way.
- **S3 is the source of truth for progress.** `complete` uses `ListParts`, not the client's list of ETags, and rejects parts of the wrong size. A client cannot complete an upload with a different size than it declared, and the browser does not need the `ETag` header exposed.
- **The S3 multipart `UploadId` never leaves the server**; clients only know our upload id.
- **Checksums**: the AWS SDK adds CRC32 checksums to signed requests by default, which a presigned URL cannot satisfy from a browser. The API's S3 client is configured with `requestChecksumCalculation: 'WHEN_REQUIRED'`.
- **The client** (`@incident-triage/upload-client`) uploads 4 parts in parallel, signs URLs in batches of 20, retries each part up to 5 times with exponential backoff and full jitter, refreshes a URL on `403`, and remembers `file fingerprint → upload id` so an interrupted upload resumes from the parts already stored. It has no framework dependency, so the same code runs in Angular, in a WebView and in Node.
- **Cleanup**: a bucket lifecycle rule aborts multipart uploads that stay incomplete for a day.

## Alternatives considered

- **Proxy through the API** (`multipart/form-data` to NestJS, then to S3) — simplest, but the API pays for every byte, and a dropped connection restarts the file.
- **Single presigned `PUT`** — fine up to ~100 MB, but S3 caps one `PUT` at 5 GB, there is no resume, and one slow connection carries the whole file.
- **tus protocol** (tus-node-server, Uppy) — a good open standard for resumable uploads, but it adds a server component in the data path; S3 multipart gives the same resumability with no bytes through our servers.
- **Presigned POST policy** — can enforce size and content type in the signature, but it is single-request, so no parallelism or resume.

## Consequences

- API instances stay small and stateless with respect to file data; throughput scales with S3.
- The bucket must allow CORS `PUT` from the origins that host the widget. Locally the API sets permissive rules on startup (`S3_CREATE_BUCKET=true`); in AWS, CDK will own them.
- Presigned URLs must point at a host the client can reach. Behind Docker or a private endpoint this needs a separate public endpoint setting.
- Upload metadata lives in memory for now, so restarting the API forgets in-flight uploads (clients start over; the lifecycle rule cleans up). It moves to Postgres with the data layer.
- Not covered yet: auth on `/uploads`, per-user quotas, malware scanning of finished objects, and end-to-end checksums (`x-amz-checksum-sha256` per part).
