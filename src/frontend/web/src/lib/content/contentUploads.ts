import { getI18n } from "react-i18next";

import { parseContentApiErrorDetail } from "@/lib/content/contentSaveErrors";
import { normalizeBaseUrl } from "@/lib/utils";

export type ContentPreflightResult = {
  sourceFormat: string | null;
  error: string | null;
};

export type ContentUploadErrorPresentation = {
  message: string;
  code: string | null;
  details: Record<string, unknown>;
};

const HASH_CHUNK_BYTES = 2 * 1024 * 1024;

/** Identify exact file bytes independently from a browser-generated timestamp. */
export function contentFileFingerprint(file: File, sha256: string): string {
  return [
    file.name,
    file.type || "application/octet-stream",
    String(file.size),
    sha256,
  ].join(":");
}

/** Hash exact browser bytes incrementally in a cancellable dedicated worker. */
export function sha256File(
  file: File,
  options?: {
    signal?: AbortSignal;
    onProgress?: (percent: number) => void;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../../workers/content-hash-worker.ts", import.meta.url),
      { type: "module" },
    );
    const abort = () => {
      worker.terminate();
      reject(
        new DOMException(getI18n().t("errors:uploads.cancelled"), "AbortError"),
      );
    };
    const cleanup = () => {
      options?.signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    worker.addEventListener(
      "message",
      (
        event: MessageEvent<
          | { type: "progress"; loaded: number; total: number }
          | { type: "complete"; sha256: string }
          | { type: "error"; message: string }
        >,
      ) => {
        if (event.data.type === "progress") {
          options?.onProgress?.(
            event.data.total > 0
              ? Math.min(
                  100,
                  Math.round((event.data.loaded / event.data.total) * 100),
                )
              : 100,
          );
          return;
        }
        cleanup();
        if (event.data.type === "complete") {
          options?.onProgress?.(100);
          resolve(event.data.sha256);
        } else {
          reject(new Error(event.data.message));
        }
      },
    );
    worker.addEventListener("error", () => {
      cleanup();
      reject(new Error(getI18n().t("errors:uploads.hashingFailed")));
    });
    options?.signal?.addEventListener("abort", abort, { once: true });
    if (options?.signal?.aborted) {
      abort();
      return;
    }
    worker.postMessage({ file, chunkSize: HASH_CHUNK_BYTES });
  });
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

/**
 * Detect a few cheap, deterministic source signatures before upload. This is
 * guidance only; backend canonicalization remains authoritative.
 */
export async function preflightContentFile(
  kind: string,
  file: File,
): Promise<ContentPreflightResult> {
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const header = ascii(bytes.slice(0, 12));
  if (kind === "image") {
    if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) {
      return {
        sourceFormat: "gif",
        error: getI18n().t("errors:uploads.gifUnsupported"),
      };
    }
    if (ascii(bytes.slice(4, 8)) === "ftyp") {
      const brand = ascii(bytes.slice(8, 12)).toLowerCase();
      if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
        return {
          sourceFormat: "heic",
          error: getI18n().t("errors:uploads.heicUnsupported"),
        };
      }
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8)
      return { sourceFormat: "jpeg", error: null };
    if (header.startsWith("\u0089PNG"))
      return { sourceFormat: "png", error: null };
    if (header.startsWith("RIFF") && ascii(bytes.slice(8, 12)) === "WEBP")
      return { sourceFormat: "webp", error: null };
  }
  if (kind === "animation") {
    if (header.startsWith("glTF")) return { sourceFormat: "glb2", error: null };
    const text = new TextDecoder().decode(bytes).trimStart();
    if (text.startsWith("{")) return { sourceFormat: "json-gltf", error: null };
    return {
      sourceFormat: null,
      error: getI18n().t("errors:uploads.vrmaUnrecognized"),
    };
  }
  return { sourceFormat: null, error: null };
}

/** Resolve an API-relative upload target against the configured FastAPI origin. */
export function resolveApiUploadUrl(
  url: string,
  apiBaseUrl = typeof window !== "undefined" ? window.location.origin : "",
): string {
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url)) return url;
  if (!apiBaseUrl) return url;
  return new URL(url, `${normalizeBaseUrl(apiBaseUrl)}/`).href;
}

/** Preserve upload-integrity metadata while rejecting browser identity headers. */
export function gatewayUploadHeaders(headers?: HeadersInit): Headers {
  const normalized = new Headers(headers);
  normalized.delete("authorization");
  return normalized;
}

export function getContentUploadErrorPresentation(
  error: unknown,
  fallback: string = getI18n().t("errors:uploads.failed"),
): ContentUploadErrorPresentation {
  const detail = parseContentApiErrorDetail(error);
  if (detail) {
    const { code, field, reason, details } = detail;
    if (code === "content_invalid" && field && reason) {
      return {
        message: remediationForContentError(reason, details),
        code: `${code}.${field}.${reason}`,
        details,
      };
    }
    if (code) return { message: conflictMessage(code), code, details };
  }
  if (error instanceof Error && error.message.trim())
    return { message: error.message, code: null, details: {} };
  if (typeof error === "string" && error.trim())
    return { message: error, code: null, details: {} };
  return { message: fallback, code: null, details: {} };
}

/** Guidance for an upload state conflict, by code. */
function conflictMessage(code: string): string {
  const t = getI18n().t;
  switch (code) {
    case "content_upload_idempotency_mismatch":
      return t("errors:uploads.content_upload_idempotency_mismatch");
    case "content_upload_retry_required":
      return t("errors:uploads.content_upload_retry_required");
    case "content_uploads_incomplete":
      return t("errors:uploads.content_uploads_incomplete");
    case "content_storage_unavailable":
      return t("errors:uploads.content_storage_unavailable");
    default:
      return t("errors:uploads.conflict");
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(0, 8)
    : [];
}

/** Translate stable backend reasons into corrective product guidance. */
function remediationForContentError(
  reason: string,
  details: Record<string, unknown>,
): string {
  const t = getI18n().t;
  switch (reason) {
    case "animated_image_unsupported":
      return t("errors:uploads.animated_image_unsupported");
    case "unsupported_image_format":
      return t("errors:uploads.unsupported_image_format");
    case "content_mismatch":
      return t("errors:uploads.content_mismatch");
    case "invalid_glb_header":
      return t("errors:uploads.invalid_glb_header");
    case "vrma_external_resource":
      return t("errors:uploads.vrma_external_resource");
    case "vrma_animation_count":
      return details.animation_count == null
        ? t("errors:uploads.vrmaAnimationCount")
        : t("errors:uploads.vrma_animation_count", {
            animations: String(details.animation_count),
          });
    case "audio_unsupported_codec": {
      const codecs = stringList(details.supported_codecs);
      return codecs.length
        ? t("errors:uploads.audio_unsupported_codec", {
            codecs: codecs.join(", "),
          })
        : t("errors:uploads.audioCodecUnsupported");
    }
    case "document_unsupported_encoding":
      return t("errors:uploads.document_unsupported_encoding");
    case "document_invalid_pdf":
      return t("errors:uploads.document_invalid_pdf");
    case "document_pdf_encrypted":
      return t("errors:uploads.document_pdf_encrypted");
    case "document_invalid_utf8":
      return t("errors:uploads.document_invalid_utf8");
    case "document_utf8_bom":
      return t("errors:uploads.document_utf8_bom");
    case "document_invalid_json":
      return t("errors:uploads.document_invalid_json");
    case "document_pdf_page_limit":
      return t("errors:uploads.document_pdf_page_limit");
    case "manifest_reference_mismatch":
      return particleMismatchMessage(details);
    case "ambiguous_particle_texture_filename":
      return t("errors:uploads.ambiguous_particle_texture_filename");
    case "cardinality":
      return cardinalityMessage(details);
    case "invalid_image":
    case "image_pixel_budget":
    case "canonical_image_size_limit":
      return t("errors:uploads.imageLimits");
  }
  if (reason.startsWith("vrma_")) return t("errors:uploads.vrmaInvalid");
  if (reason.startsWith("vrm_")) return t("errors:uploads.vrmInvalid");
  if (reason.startsWith("audio_")) return t("errors:uploads.audioInvalid");
  if (
    reason.startsWith("invalid_anima_pose_clip_") ||
    reason === "anima_pose_clip_duration_limit"
  ) {
    return t("errors:uploads.poseClipInvalid");
  }
  if (
    reason.startsWith("invalid_particle_vfx_") ||
    reason.startsWith("unsupported_particle_vfx_") ||
    reason.startsWith("unbounded_particle_vfx_") ||
    reason.startsWith("particle_vfx_") ||
    reason.startsWith("duplicate_particle_vfx_")
  ) {
    return t("errors:uploads.particleManifestInvalid");
  }
  return t("errors:uploads.unprocessable");
}

function cardinalityMessage(details: Record<string, unknown>): string {
  const { minimum_count, maximum_count, actual_count } = details;
  return minimum_count == null || maximum_count == null || actual_count == null
    ? getI18n().t("errors:uploads.cardinalityUnknown")
    : getI18n().t("errors:uploads.cardinality", {
        minimum: String(minimum_count),
        maximum: String(maximum_count),
        actual: String(actual_count),
      });
}

function particleMismatchMessage(details: Record<string, unknown>): string {
  const missing = stringList(details.missing_filenames).join(", ");
  const unexpected = stringList(details.unexpected_filenames).join(", ");
  const t = getI18n().t;
  if (missing && unexpected)
    return t("errors:uploads.particleMissingAndUnexpected", {
      missing,
      unexpected,
    });
  if (missing) return t("errors:uploads.particleMissing", { missing });
  if (unexpected) return t("errors:uploads.particleUnexpected", { unexpected });
  return t("errors:uploads.manifest_reference_mismatch");
}
