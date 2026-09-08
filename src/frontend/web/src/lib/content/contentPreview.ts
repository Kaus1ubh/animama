import type {
  PyContentPreview,
  PyContentFile,
} from "@/lib/content/catalogTypes";
import { resolvePrivateRuntimeContentUrl } from "@/lib/runtime-content/runtimeContentDelivery";

/** Return whether an authorized preview remains usable beyond a safety margin. */
export function contentPreviewLeaseIsFresh(
  expiresAt: string | null | undefined,
  now = Date.now(),
  marginMs = 60_000,
): boolean {
  if (!expiresAt) return false;
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs - now > marginMs;
}

/** Build the exact registered-file URL for one short-lived preview. */
export function contentPreviewFileUrl(
  preview: Pick<PyContentPreview, "preview_id" | "revision">,
  file: Pick<PyContentFile, "file_ref">,
): string {
  return `/v1/content/previews/${encodeURIComponent(preview.preview_id)}/revisions/${encodeURIComponent(preview.revision)}/files/${encodeURIComponent(file.file_ref)}`;
}

/** Fetch one private preview file through the same-origin local gateway. */
export async function fetchContentPreviewFile(
  preview: Pick<PyContentPreview, "preview_id" | "revision">,
  file: Pick<PyContentFile, "file_ref">,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<Response> {
  const relativeUrl = contentPreviewFileUrl(preview, file);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const url = baseUrl
    ? resolvePrivateRuntimeContentUrl(relativeUrl, baseUrl)
    : relativeUrl;
  return (options.fetcher ?? fetch)(url, {
    cache: "no-cache",
    credentials: "same-origin",
    redirect: "error",
    signal: options.signal,
  });
}

/** Keep preview rendering role-driven rather than relying on filenames. */
export function contentPreviewPrimaryFile(
  preview: PyContentPreview,
  role: string,
): PyContentFile | null {
  return (
    preview.files
      .filter((file) => file.role === role)
      .sort((left, right) => left.ordinal - right.ordinal)[0] ?? null
  );
}
