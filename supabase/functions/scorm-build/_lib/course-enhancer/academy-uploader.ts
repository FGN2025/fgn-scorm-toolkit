/**
 * Stub of academy-uploader.ts for the scorm-build edge function.
 *
 * The original toolkit-side helper POSTs to the media-upload edge
 * function over HTTP with X-App-Key auth. Inside the scorm-build edge
 * function (which runs ON fgn.academy), we don't need that round-trip
 * — we have direct service-role access to Supabase Storage and can
 * write the cover bytes there directly.
 *
 * This stub exists so the enhance.ts import resolves. The
 * `uploadToAcademy` flag in enhance options should be set to FALSE
 * inside scorm-build's call to enhanceCourse(); the edge function
 * handles cover storage itself rather than calling uploadCoverToAcademy.
 *
 * Throwing on actual call ensures we'd see a loud error if anything
 * tried to use this code path inside the edge function.
 */

export interface UploadCoverOptions {
  appKey?: string;
  endpoint?: string;
  courseId: string;
}

export interface UploadCoverResult {
  url: string;
  storagePath: string;
  bytes: number;
  mimeType: string;
}

export class AcademyUploadError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = 'AcademyUploadError';
  }
}

export function uploadCoverToAcademy(
  _bytes: Uint8Array,
  _mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
  _opts: UploadCoverOptions,
): Promise<UploadCoverResult> {
  throw new Error(
    'uploadCoverToAcademy() is not available in the scorm-build edge function. ' +
    'Storage writes happen directly via service role; do not pass uploadToAcademy=true ' +
    'when calling enhanceCourse from inside this function.',
  );
}
