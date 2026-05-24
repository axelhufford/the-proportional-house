/**
 * Browser-side download helpers for the projection data.
 *
 * Both helpers reuse the curated v1 shape from `apiShape.ts` so the file
 * a user downloads has the same structure as the public API response —
 * meaning a journalist who downloads the CSV today and switches to scripted
 * API consumption tomorrow doesn't have to relearn the schema.
 */
import type { ProjectionPayload } from './types';
import { toApiV1, toApiV1Csv } from './apiShape';

/** Pretty-printed JSON of the v1 payload, terminated by a newline. */
export function toJsonExport(payload: ProjectionPayload): string {
  return JSON.stringify(toApiV1(payload), null, 2) + '\n';
}

/** CSV form of the v1 payload (re-exported for symmetry). */
export const toCsvExport = toApiV1Csv;

/**
 * Trigger a file download in the browser. Creates a transient Blob URL,
 * clicks a hidden <a download>, and revokes the URL on the next tick so
 * the browser has a chance to start the download first.
 */
export function downloadBlob(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoke after a tick — revoking synchronously can race the download
  // start in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadProjectionCsv(payload: ProjectionPayload): void {
  downloadBlob(
    'proportional-house-projection.csv',
    'text/csv;charset=utf-8',
    toCsvExport(payload),
  );
}

export function downloadProjectionJson(payload: ProjectionPayload): void {
  downloadBlob(
    'proportional-house-projection.json',
    'application/json;charset=utf-8',
    toJsonExport(payload),
  );
}
