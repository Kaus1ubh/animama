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
      reject(new DOMException("Upload cancelled.", "AbortError"));
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
      reject(new Error("File hashing failed."));
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
        error:
          "Animated GIF is not supported. Export one still frame as JPEG, PNG, or WebP.",
      };
    }
    if (ascii(bytes.slice(4, 8)) === "ftyp") {
      const brand = ascii(bytes.slice(8, 12)).toLowerCase();
      if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
        return {
          sourceFormat: "heic",
          error:
            "HEIC/HEIF is not supported yet. Export the image as JPEG, PNG, or WebP.",
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
      error:
        "This does not look like JSON glTF or binary GLB VRMA. Re-export the animation as a self-contained .vrma file.",
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
  fallback = "Content upload failed.",
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
    if (code)
      return {
        message:
          CONFLICT_MESSAGES[code] ??
          "The content could not be updated in its current state. Refresh and try again.",
        code,
        details,
      };
  }
  if (error instanceof Error && error.message.trim())
    return { message: error.message, code: null, details: {} };
  if (typeof error === "string" && error.trim())
    return { message: error, code: null, details: {} };
  return { message: fallback, code: null, details: {} };
}

const CONFLICT_MESSAGES: Record<string, string> = {
  content_upload_idempotency_mismatch:
    "That retry is a different file. Remove the old draft file first, then choose the replacement.",
  content_upload_retry_required:
    "Retry this file to create a fresh private staging upload.",
  content_uploads_incomplete:
    "Some package files still need attention before this content can be saved.",
  content_storage_unavailable:
    "Private storage is temporarily unavailable. Your draft is preserved; try again.",
};

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
  const messages: Record<string, string> = {
    animated_image_unsupported:
      "Animated PNG/WebP is not supported for still images. Export one static frame and retry.",
    unsupported_image_format:
      "This image format is not supported. Export it as JPEG, PNG, or static WebP.",
    content_mismatch:
      "The file contents do not match the selected format. Re-export the source instead of renaming its extension.",
    invalid_glb_header:
      "This is not a valid binary GLB file. Re-export it from a VRM-compatible tool.",
    vrma_external_resource:
      "VRMA must be self-contained. Embed its buffers and remove external URLs before retrying.",
    vrma_animation_count: `VRMA must contain exactly one animation; this file contains ${String(details.animation_count ?? "an unsupported number")}.`,
    audio_unsupported_codec: `This audio codec is not supported. Use ${stringList(details.supported_codecs).join(", ") || "a supported MP3, WAV, or Ogg codec"}.`,
    document_unsupported_encoding:
      "Text documents must be UTF-8 without a UTF-16/UTF-32 byte-order mark.",
    document_invalid_pdf:
      "The PDF is incomplete or malformed. Open and re-export it as a standard, unencrypted PDF.",
    document_pdf_encrypted:
      "Encrypted PDFs are not supported. Save an unencrypted copy and retry.",
    document_invalid_utf8:
      "This text is not valid UTF-8. Re-save it as UTF-8 without a byte-order mark.",
    document_utf8_bom:
      "Remove the UTF-8 byte-order mark, then save and retry the document.",
    document_invalid_json:
      "This JSON document is incomplete or malformed. Correct its syntax and retry.",
    document_pdf_page_limit:
      "This PDF has too many pages. Split it into smaller documents and retry.",
    manifest_reference_mismatch: particleMismatchMessage(details),
    ambiguous_particle_texture_filename:
      "Particle texture filenames must remain unique when case and Unicode differences are ignored. Rename the colliding textures and update the manifest.",
    cardinality: `This role needs ${String(details.minimum_count ?? "the required")}–${String(details.maximum_count ?? "the allowed")} files; it currently has ${String(details.actual_count ?? "an invalid number")}.`,
  };
  if (messages[reason]) return messages[reason];
  if (
    reason === "invalid_image" ||
    reason === "image_pixel_budget" ||
    reason === "canonical_image_size_limit"
  ) {
    return "The image cannot be normalized within Animama's size and pixel limits. Resize it, export a standard still JPEG/PNG/WebP, and retry.";
  }
  if (reason.startsWith("vrma_")) {
    return "The VRMA package is not a complete, self-contained animation Animama can play. Re-export one glTF 2 animation with embedded buffers and VRMC_vrm_animation 1.0.";
  }
  if (reason.startsWith("vrm_")) {
    return "The avatar is not a complete runtime-compatible VRM. Re-export a self-contained GLB VRM with a valid humanoid definition.";
  }
  if (reason.startsWith("audio_")) {
    return "The audio stream is incomplete or outside Animama's playback limits. Re-export a stereo-or-mono MP3, PCM/float WAV, Vorbis Ogg, or Opus Ogg at 8–96 kHz and retry.";
  }
  if (
    reason.startsWith("invalid_anima_pose_clip_") ||
    reason === "anima_pose_clip_duration_limit"
  ) {
    return "The pose clip does not match Animama's timeline, pose, event, or playback schema. Correct the manifest in the pose editor and export it again.";
  }
  if (
    reason.startsWith("invalid_particle_vfx_") ||
    reason.startsWith("unsupported_particle_vfx_") ||
    reason.startsWith("unbounded_particle_vfx_") ||
    reason.startsWith("particle_vfx_") ||
    reason.startsWith("duplicate_particle_vfx_")
  ) {
    return "The particle manifest uses an unsupported or unsafe Three.quarks shape. Correct the named system, generator, behavior, resource, or budget and export the package again.";
  }
  return "Animama could not process this file for the selected content type. Correct the source and retry, or replace this draft file.";
}

function particleMismatchMessage(details: Record<string, unknown>): string {
  const missing = stringList(details.missing_filenames);
  const unexpected = stringList(details.unexpected_filenames);
  const parts = [
    missing.length > 0 ? `add ${missing.join(", ")}` : "",
    unexpected.length > 0 ? `remove or rename ${unexpected.join(", ")}` : "",
  ].filter(Boolean);
  return parts.length > 0
    ? `The particle manifest and texture files do not match: ${parts.join("; ")}.`
    : "The particle manifest and texture files do not match. Replace the manifest or the incorrect texture without re-uploading the verified files.";
}
