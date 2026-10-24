import { describe, expect, it } from 'vitest';
import { S3_MAX_PARTS, S3_MIN_PART_SIZE, expectedPartSize, planParts } from './upload-plan';

const MiB = 1024 * 1024;

describe('planParts', () => {
  it('uses the preferred part size for ordinary files', () => {
    expect(planParts(100 * MiB, 8 * MiB)).toEqual({ partSize: 8 * MiB, partCount: 13 });
  });

  it('never goes below the S3 minimum part size', () => {
    expect(planParts(20 * MiB, 1 * MiB).partSize).toBe(S3_MIN_PART_SIZE);
  });

  it('grows the part size so a huge file fits in 10,000 parts', () => {
    const size = 200 * 1024 * MiB;
    const plan = planParts(size, 8 * MiB);
    expect(plan.partCount).toBeLessThanOrEqual(S3_MAX_PARTS);
    expect(plan.partSize * plan.partCount).toBeGreaterThanOrEqual(size);
  });

  it('plans a single part for a small file', () => {
    expect(planParts(10, 8 * MiB)).toEqual({ partSize: 8 * MiB, partCount: 1 });
  });

  it('rejects empty and fractional sizes', () => {
    expect(() => planParts(0, 8 * MiB)).toThrow(RangeError);
    expect(() => planParts(1.5, 8 * MiB)).toThrow(RangeError);
  });
});

describe('expectedPartSize', () => {
  it('gives the remainder to the last part', () => {
    const size = 20 * MiB + 3;
    const plan = planParts(size, 8 * MiB);
    expect(expectedPartSize(plan, size, 1)).toBe(8 * MiB);
    expect(expectedPartSize(plan, size, 3)).toBe(4 * MiB + 3);
  });
});
