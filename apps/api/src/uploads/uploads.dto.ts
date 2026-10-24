import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const createUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  contentType: z.string().max(255).default('application/octet-stream'),
});
export type CreateUploadInput = z.infer<typeof createUploadSchema>;

export const signPartsSchema = z.object({
  // Signing in batches saves a round-trip per part; the cap keeps responses small.
  partNumbers: z.array(z.number().int().positive()).min(1).max(100),
});
export type SignPartsInput = z.infer<typeof signPartsSchema>;

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({ message: 'Invalid request body', issues: result.error.issues });
  }
  return result.data;
}

export interface UploadView {
  id: string;
  key: string;
  fileName: string;
  size: number;
  partSize: number;
  partCount: number;
  status: 'uploading' | 'completed' | 'aborted';
}

export interface UploadStatusView extends UploadView {
  /** Parts already stored, for resuming an interrupted upload. */
  uploadedParts: { partNumber: number; size: number }[];
}

export interface SignedPartsView {
  expiresAt: string;
  parts: { partNumber: number; url: string }[];
}
