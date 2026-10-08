/**
 * Limits for untrusted Avatar Effect images and definitions.
 *
 * Images come from Local content, imported packages and creator uploads. Their
 * size and dimensions are checked from the container header before the browser
 * decodes them, and again from the decoded size before any GPU upload, so a
 * small file cannot expand into a huge texture. Avatar Effect images are not
 * resized when stored (the backend admits up to 16384 px per side): the
 * creator refuses an oversized image when it is chosen, and an imported or
 * hand-placed Local image over these bounds fails closed when it loads.
 */

/** Bytes per effect image; matches the runtime media budget. */
export const MAX_AVATAR_EFFECT_IMAGE_BYTES = 16 * 1024 * 1024;
/** Longest side of an effect image, in pixels. */
export const MAX_AVATAR_EFFECT_IMAGE_DIMENSION = 4096;
/** Decoded pixels per effect image (4096 × 4096). */
export const MAX_AVATAR_EFFECT_IMAGE_PIXELS = 4096 * 4096;
/** Serialized bytes of one definition; real `/2` definitions are under 4 KiB. */
export const MAX_AVATAR_EFFECT_DEFINITION_BYTES = 64 * 1024;

export type ImageDimensions = { width: number; height: number };

/** Header bytes read before decoding; enough for PNG, WebP and typical JPEG SOF positions. */
const HEADER_BYTES = 256 * 1024;

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) >>> 0) +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}

function u24le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/**
 * Read width and height from a PNG, JPEG or WebP header without decoding.
 * Returns null for an unknown or truncated container.
 */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length >= 24 &&
    u32be(bytes, 0) === 0x89504e47 &&
    ascii(bytes, 12, 4) === "IHDR"
  ) {
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (
    bytes.length >= 30 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8X") {
      return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const bits =
        bytes[21]! |
        (bytes[22]! << 8) |
        (bytes[23]! << 16) |
        (bytes[24]! << 24);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    if (
      chunk === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      return {
        width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
        height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
      };
    }
    return null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1]!;
      if (
        marker === 0xd8 ||
        (marker >= 0xd0 && marker <= 0xd7) ||
        marker === 0x01
      ) {
        offset += 2;
        continue;
      }
      const length = u16be(bytes, offset + 2);
      // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      ) {
        return {
          width: u16be(bytes, offset + 7),
          height: u16be(bytes, offset + 5),
        };
      }
      if (length < 2) return null;
      offset += 2 + length;
    }
  }
  return null;
}

/** Throw unless decoded or declared dimensions fit the effect image budget. */
export function assertAvatarEffectImageDimensions(
  dimensions: ImageDimensions,
): void {
  const { width, height } = dimensions;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    Math.max(width, height) > MAX_AVATAR_EFFECT_IMAGE_DIMENSION ||
    width * height > MAX_AVATAR_EFFECT_IMAGE_PIXELS
  ) {
    throw new Error("avatar_vfx_image_dimensions_invalid");
  }
}

/**
 * Check an untrusted image's byte size and header dimensions before it is
 * decoded. Returns the declared dimensions.
 */
export async function assertAvatarEffectImageWithinLimits(
  blob: Blob,
): Promise<ImageDimensions> {
  if (blob.size < 1 || blob.size > MAX_AVATAR_EFFECT_IMAGE_BYTES) {
    throw new Error("avatar_vfx_image_size_invalid");
  }
  const header = new Uint8Array(
    await blob.slice(0, HEADER_BYTES).arrayBuffer(),
  );
  const dimensions = readImageDimensions(header);
  if (!dimensions) throw new Error("avatar_vfx_image_format_invalid");
  assertAvatarEffectImageDimensions(dimensions);
  return dimensions;
}

/** Throw unless a definition stays within the serialized size budget. */
export function assertAvatarEffectDefinitionSize(definition: unknown): void {
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(definition) ?? "").length;
  } catch {
    throw new Error("avatar_vfx_definition_invalid");
  }
  if (size > MAX_AVATAR_EFFECT_DEFINITION_BYTES) {
    throw new Error("avatar_vfx_definition_too_large");
  }
}
