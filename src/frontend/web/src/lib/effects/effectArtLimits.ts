/**
 * Hard limits for Particle Effect textures and Scene Effect images.
 *
 * Both are untrusted input: they come from creator imports, Local content and
 * Portable packages. The creators check a file's size and container header
 * against these limits before the browser decodes it or uploads it to the GPU;
 * the backend checks the same limits at Save and package import, and the
 * runtime loaders check them again. The asset scripts' Particle and Scene
 * budgets are stricter authoring targets inside these limits.
 *
 * `lib/content/fixtures/effect-art-limits.json` records the values for the
 * parity tests that keep the scripts, this module and the backend equal.
 */
import { readImageDimensions } from "../avatar/vfx/effect-image-limits";

export type EffectArtLimits = {
  /** Bytes of one image file. */
  bytes: number;
  /** Longest side, in pixels. */
  dimension: number;
  /** Decoded pixels of one image. */
  pixels: number;
  /** Images per effect. */
  count: number;
  /** Bytes of all images in one effect. */
  totalBytes: number;
};

/** Particle textures, including sprite sheets of up to `grid` × `grid` tiles. */
export const PARTICLE_TEXTURE_LIMITS = {
  bytes: 4 * 1024 * 1024,
  dimension: 2048,
  pixels: 2048 * 2048,
  grid: 16,
  count: 16,
  totalBytes: 32 * 1024 * 1024,
} as const satisfies EffectArtLimits & { grid: number };

/** Scene images: stickers, pattern tiles and full backgrounds. */
export const SCENE_IMAGE_LIMITS = {
  bytes: 8 * 1024 * 1024,
  dimension: 4096,
  pixels: 4096 * 4096,
  count: 16,
  totalBytes: 32 * 1024 * 1024,
} as const satisfies EffectArtLimits;

export type EffectArtFormat = "png" | "jpeg" | "webp";

/** Why an image was refused, and the limit it broke (null for a bad format). */
export type EffectArtRefusal = {
  ok: false;
  reason: "bytes" | "format" | "dimension" | "pixels";
  limit: number | null;
};

export type EffectArtInspection =
  | { ok: true; format: EffectArtFormat; width: number; height: number }
  | EffectArtRefusal;

/** Header bytes read before decoding; enough for PNG, WebP and typical JPEG. */
const HEADER_BYTES = 256 * 1024;

/** Identify a PNG, JPEG or WebP container from its first bytes. */
export function detectEffectArtFormat(
  bytes: Uint8Array,
): EffectArtFormat | null {
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    )
  )
    return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8)
    return "jpeg";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  )
    return "webp";
  return null;
}

/**
 * Check an untrusted image's size, format and header dimensions without
 * decoding it. `formats` narrows the accepted containers (the Particle
 * creator imports PNG only).
 */
export async function inspectEffectArt(
  blob: Blob,
  limits: EffectArtLimits,
  { formats }: { formats?: readonly EffectArtFormat[] } = {},
): Promise<EffectArtInspection> {
  if (blob.size > limits.bytes)
    return { ok: false, reason: "bytes", limit: limits.bytes };
  const header = new Uint8Array(
    await blob.slice(0, HEADER_BYTES).arrayBuffer(),
  );
  const format = detectEffectArtFormat(header);
  const dimensions = format ? readImageDimensions(header) : null;
  if (!format || !dimensions || (formats && !formats.includes(format)))
    return { ok: false, reason: "format", limit: null };
  const { width, height } = dimensions;
  if (width < 1 || height < 1)
    return { ok: false, reason: "format", limit: null };
  if (Math.max(width, height) > limits.dimension)
    return { ok: false, reason: "dimension", limit: limits.dimension };
  if (width * height > limits.pixels)
    return { ok: false, reason: "pixels", limit: limits.pixels };
  return { ok: true, format, width, height };
}
