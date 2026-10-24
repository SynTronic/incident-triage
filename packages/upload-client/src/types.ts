// Wire types of the API's /uploads endpoints.

export type UploadStatus = 'uploading' | 'completed' | 'aborted';

export interface UploadView {
  id: string;
  key: string;
  fileName: string;
  size: number;
  partSize: number;
  partCount: number;
  status: UploadStatus;
}

export interface UploadStatusView extends UploadView {
  uploadedParts: { partNumber: number; size: number }[];
}

export interface SignedPartsView {
  expiresAt: string;
  parts: { partNumber: number; url: string }[];
}
