#!/usr/bin/env node
// Uploads a local file through the API, the same way the browser widget does.
//   pnpm --filter @incident-triage/upload-client upload ./big.log
// Stop it with Ctrl+C and run it again: it continues from the parts already stored.
import { openAsBlob } from 'node:fs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { Uploader } from '../dist/index.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: upload-file <path> [apiUrl]');
  process.exit(1);
}
const apiUrl = process.argv[3] ?? process.env.API_URL ?? 'http://localhost:3000';

// A file-backed resume store, so the upload survives a restart of this script.
const stateFile = join(homedir(), '.incident-triage', 'uploads.json');
const readState = () => {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
};
const writeState = (state) => {
  mkdirSync(join(homedir(), '.incident-triage'), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
};
const resumeStore = {
  get: (key) => readState()[key],
  set: (key, id) => writeState({ ...readState(), [key]: id }),
  delete: (key) => {
    const { [key]: _, ...rest } = readState();
    writeState(rest);
  },
};

const blob = await openAsBlob(path);
const file = Object.assign(blob, { name: basename(path), lastModified: 0 });
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());

const started = Date.now();
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
try {
  const result = await new Uploader({ apiUrl, resumeStore }).upload(file, {
    signal: controller.signal,
    onStart: (u) => console.log(`upload ${u.id}: ${u.partCount} parts of ${mb(u.partSize)} MiB`),
    onProgress: (p) =>
      process.stdout.write(
        `\r${mb(p.uploadedBytes)}/${mb(p.totalBytes)} MiB, parts ${p.uploadedParts}/${p.totalParts}` +
          (p.resumed ? ' (resumed)' : ''),
      ),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(`\nstored as ${result.key} in ${seconds.toFixed(1)}s (${mb(result.size / seconds)} MiB/s)`);
} catch (error) {
  if (controller.signal.aborted) {
    console.log('\npaused; run the same command again to resume');
  } else {
    console.error('\n', error);
    process.exitCode = 1;
  }
}
