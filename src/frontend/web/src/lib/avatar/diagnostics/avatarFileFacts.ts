import { LILTOON_MATERIALS_EXTENSION } from "../liltoon/lilToon";

/** How a material is drawn, as its file declares it. */
export type AvatarMaterialKind = "mtoon" | "liltoon" | "unlit" | "pbr";

export type AvatarTextureFacts = {
  mimeType: string | null;
  /** Encoded size; null for an image outside the file. */
  byteLength: number | null;
  /** Pixel size read from the image header; null when unreadable. */
  width: number | null;
  height: number | null;
};

/**
 * What an Avatar file holds, read from its glTF JSON and embedded image
 * headers without running a loader, so a file that does not load is still
 * described. Counts and types only: no node, mesh, material or texture names.
 */
export type AvatarFileFacts = {
  byteLength: number;
  container: "glb" | "gltf";
  /** "0.x" for the `VRM` extension, the spec version for `VRMC_vrm`. */
  vrmVersion: string | null;
  extensionsUsed: string[];
  extensionsRequired: string[];
  meshCount: number;
  primitiveCount: number;
  /** Primitives with morph targets (face shapes, usually). */
  morphedPrimitiveCount: number;
  materialCount: number;
  materialKinds: Record<AvatarMaterialKind, number>;
  textures: AvatarTextureFacts[];
};

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_JSON_CHUNK = 0x4e4f534a; // "JSON"
const GLB_BIN_CHUNK = 0x004e4942; // "BIN\0"

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStrings(value: unknown): string[] {
  return asArray(value).filter(
    (item): item is string => typeof item === "string",
  );
}

/** The glTF JSON and the GLB binary chunk, or null when not a glTF file. */
function readContainer(bytes: Uint8Array): {
  container: AvatarFileFacts["container"];
  json: JsonRecord;
  bin: Uint8Array | null;
} | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 20 && view.getUint32(0, true) === GLB_MAGIC) {
    const declaredLength = view.getUint32(8, true);
    const end = Math.min(declaredLength, bytes.byteLength);
    let json: JsonRecord | null = null;
    let bin: Uint8Array | null = null;
    for (let offset = 12; offset + 8 <= end; ) {
      const chunkLength = view.getUint32(offset, true);
      const chunkType = view.getUint32(offset + 4, true);
      const start = offset + 8;
      // A truncated file keeps what its complete chunks describe.
      if (start + chunkLength > end) break;
      const chunk = bytes.subarray(start, start + chunkLength);
      if (chunkType === GLB_JSON_CHUNK && !json) {
        json = parseJson(chunk);
        if (!json) return null;
      } else if (chunkType === GLB_BIN_CHUNK && !bin) {
        bin = chunk;
      }
      offset = start + chunkLength;
    }
    return json ? { container: "glb", json, bin } : null;
  }
  const json = parseJson(bytes);
  return json ? { container: "gltf", json, bin: null } : null;
}

function parseJson(bytes: Uint8Array): JsonRecord | null {
  try {
    return asRecord(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

function readVrmVersion(json: JsonRecord): string | null {
  const extensions = asRecord(json.extensions);
  const vrm1 = asRecord(extensions?.VRMC_vrm);
  if (vrm1) {
    return typeof vrm1.specVersion === "string" ? vrm1.specVersion : "1.0";
  }
  return extensions?.VRM ? "0.x" : null;
}

function readMaterialKinds(
  json: JsonRecord,
): Record<AvatarMaterialKind, number> {
  const kinds: Record<AvatarMaterialKind, number> = {
    mtoon: 0,
    liltoon: 0,
    unlit: 0,
    pbr: 0,
  };
  const vrm0Shaders = asArray(
    asRecord(asRecord(json.extensions)?.VRM)?.materialProperties,
  ).map((property) => asRecord(property)?.shader);
  asArray(json.materials).forEach((material, index) => {
    const extensions = asRecord(asRecord(material)?.extensions) ?? {};
    if (extensions[LILTOON_MATERIALS_EXTENSION]) kinds.liltoon += 1;
    else if (
      extensions.VRMC_materials_mtoon ||
      vrm0Shaders[index] === "VRM/MToon"
    ) {
      kinds.mtoon += 1;
    } else if (extensions.KHR_materials_unlit) kinds.unlit += 1;
    else kinds.pbr += 1;
  });
  return kinds;
}

/** An embedded image's bytes: from a buffer view or a data URI. */
function readImageBytes(
  json: JsonRecord,
  image: JsonRecord,
  bin: Uint8Array | null,
): Uint8Array | null {
  if (typeof image.bufferView === "number") {
    const bufferView = asRecord(asArray(json.bufferViews)[image.bufferView]);
    if (!bufferView || !bin || (bufferView.buffer ?? 0) !== 0) return null;
    const offset = Number(bufferView.byteOffset ?? 0);
    const length = Number(bufferView.byteLength ?? 0);
    const valid =
      Number.isInteger(offset) &&
      Number.isInteger(length) &&
      offset >= 0 &&
      length >= 0 &&
      offset + length <= bin.byteLength;
    if (!valid) return null;
    return bin.subarray(offset, offset + length);
  }
  if (typeof image.uri === "string" && image.uri.startsWith("data:")) {
    const comma = image.uri.indexOf(",");
    if (comma < 0 || !image.uri.slice(0, comma).endsWith(";base64")) {
      return null;
    }
    try {
      return Uint8Array.from(atob(image.uri.slice(comma + 1)), (char) =>
        char.charCodeAt(0),
      );
    } catch {
      return null;
    }
  }
  return null;
}

function readTextures(
  json: JsonRecord,
  bin: Uint8Array | null,
): AvatarTextureFacts[] {
  return asArray(json.images).map((value) => {
    const image = asRecord(value) ?? {};
    const bytes = readImageBytes(json, image, bin);
    const size = bytes ? readImagePixelSize(bytes) : null;
    return {
      mimeType: typeof image.mimeType === "string" ? image.mimeType : null,
      byteLength: bytes?.byteLength ?? null,
      width: size?.width ?? null,
      height: size?.height ?? null,
    };
  });
}

/** Pixel size from a PNG, JPEG or WebP header; null for other formats. */
export function readImagePixelSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  // PNG: the IHDR chunk follows the 8-byte signature.
  if (bytes.byteLength >= 24 && view.getUint32(0) === 0x89504e47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: the first start-of-frame marker holds the size.
  if (bytes.byteLength >= 4 && view.getUint16(0) === 0xffd8) {
    for (let offset = 2; offset + 9 <= bytes.byteLength; ) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      const length = view.getUint16(offset + 2);
      const isStartOfFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isStartOfFrame) {
        return {
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
        };
      }
      offset += 2 + length;
    }
    return null;
  }
  // WebP: a RIFF container with a lossy, lossless or extended first chunk.
  if (
    bytes.byteLength >= 30 &&
    ascii(0, 4) === "RIFF" &&
    ascii(8, 4) === "WEBP"
  ) {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 ") {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === "VP8X") {
      // 24-bit little-endian canvas size minus one.
      const uint24 = (at: number) =>
        bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
      return { width: uint24(24) + 1, height: uint24(27) + 1 };
    }
  }
  return null;
}

/**
 * Describe an Avatar file (GLB or glTF JSON), or return null when the bytes
 * are not a readable glTF file.
 */
export function readAvatarFileFacts(
  buffer: ArrayBuffer | Uint8Array,
): AvatarFileFacts | null {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const container = readContainer(bytes);
  if (!container) return null;
  const { json, bin } = container;
  const meshes = asArray(json.meshes).map((mesh) =>
    asArray(asRecord(mesh)?.primitives),
  );
  const primitives = meshes.flat().map((primitive) => asRecord(primitive));
  return {
    byteLength: bytes.byteLength,
    container: container.container,
    vrmVersion: readVrmVersion(json),
    extensionsUsed: asStrings(json.extensionsUsed),
    extensionsRequired: asStrings(json.extensionsRequired),
    meshCount: meshes.length,
    primitiveCount: primitives.length,
    morphedPrimitiveCount: primitives.filter(
      (primitive) => asArray(primitive?.targets).length > 0,
    ).length,
    materialCount: asArray(json.materials).length,
    materialKinds: readMaterialKinds(json),
    textures: readTextures(json, bin),
  };
}
