/**
 * Remembers which server upload belongs to which local file, so a page reload
 * or a dropped connection continues the upload instead of starting over.
 */
export interface ResumeStore {
  get(fingerprint: string): string | undefined;
  set(fingerprint: string, uploadId: string): void;
  delete(fingerprint: string): void;
}

export function memoryResumeStore(): ResumeStore {
  const map = new Map<string, string>();
  return {
    get: (fingerprint) => map.get(fingerprint),
    set: (fingerprint, uploadId) => void map.set(fingerprint, uploadId),
    delete: (fingerprint) => void map.delete(fingerprint),
  };
}

/** Survives reloads. Storage can be missing or throw (private mode, some WebViews), so failures are ignored. */
export function localStorageResumeStore(prefix = 'incident-triage:upload:'): ResumeStore {
  const storage = (): Storage | undefined => {
    try {
      return globalThis.localStorage;
    } catch {
      return undefined;
    }
  };
  return {
    get(fingerprint) {
      try {
        return storage()?.getItem(prefix + fingerprint) ?? undefined;
      } catch {
        return undefined;
      }
    },
    set(fingerprint, uploadId) {
      try {
        storage()?.setItem(prefix + fingerprint, uploadId);
      } catch {
        // Resume is a convenience; uploading still works without it.
      }
    },
    delete(fingerprint) {
      try {
        storage()?.removeItem(prefix + fingerprint);
      } catch {
        // See above.
      }
    },
  };
}
