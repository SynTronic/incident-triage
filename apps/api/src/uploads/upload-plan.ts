// S3 multipart limits: every part except the last must be at least 5 MiB,
// and an upload has at most 10,000 parts.
export const S3_MIN_PART_SIZE = 5 * 1024 * 1024;
export const S3_MAX_PARTS = 10_000;

export interface UploadPlan {
  partSize: number;
  partCount: number;
}

/**
 * Picks the part size for a file: the preferred size, grown just enough to fit
 * the file into S3's part limit. Bigger parts mean fewer requests; smaller parts
 * mean less work lost when a request fails.
 */
export function planParts(size: number, preferredPartSize: number): UploadPlan {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new RangeError(`size must be a positive integer, got ${size}`);
  }
  const minimum = Math.max(preferredPartSize, S3_MIN_PART_SIZE);
  const partSize = Math.max(minimum, Math.ceil(size / S3_MAX_PARTS));
  return { partSize, partCount: Math.ceil(size / partSize) };
}

/** Byte length the given part must have once uploaded. */
export function expectedPartSize(plan: UploadPlan, size: number, partNumber: number): number {
  return partNumber < plan.partCount ? plan.partSize : size - plan.partSize * (plan.partCount - 1);
}
