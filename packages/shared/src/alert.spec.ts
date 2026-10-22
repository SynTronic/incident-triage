import { describe, expect, it } from 'vitest';
import { AlertSchema } from './alert.js';

describe('AlertSchema', () => {
  const valid = {
    source: 'prometheus',
    fingerprint: 'a1b2c3',
    service: 'checkout-api',
    severity: 'critical',
    title: 'High 5xx rate',
    firedAt: '2026-10-22T07:00:00Z',
  };

  it('accepts a valid alert and defaults labels', () => {
    const alert = AlertSchema.parse(valid);
    expect(alert.labels).toEqual({});
  });

  it('rejects an unknown severity', () => {
    expect(AlertSchema.safeParse({ ...valid, severity: 'urgent' }).success).toBe(false);
  });
});
