import { z } from 'zod';

export const Severity = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export type Severity = z.infer<typeof Severity>;

/** An alert as it arrives from a monitoring source, before correlation. */
export const AlertSchema = z.object({
  source: z.string().min(1),
  fingerprint: z.string().min(1),
  service: z.string().min(1),
  severity: Severity,
  title: z.string().min(1),
  firedAt: z.iso.datetime(),
  labels: z.record(z.string(), z.string()).default({}),
});
export type Alert = z.infer<typeof AlertSchema>;
