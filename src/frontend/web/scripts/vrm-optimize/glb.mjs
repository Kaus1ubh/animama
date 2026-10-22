/**
 * Minimal GLB container reading, accessor expansion and writing for the VRM
 * optimizer. The JSON document is edited in place, so every extension and
 * index the optimizer does not deliberately change survives untouched.
 */

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

export const COMPONENT_SIZE = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};
export const TYPE_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

/** Parse a GLB 2.0 file into its JSON document and binary chunk. */
export function readGlb(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error("Not a GLB file.");
  }
  if (buffer.readUInt32LE(4) !== 2)
    throw new Error("Only GLB version 2 is supported.");
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== JSON_CHUNK)
    throw new Error("The first GLB chunk is not JSON.");
  const json = JSON.parse(
    buffer.subarray(20, 20 + jsonLength).toString("utf8"),
  );
  const binOffset = 20 + jsonLength;
  let bin = Buffer.alloc(0);
  if (binOffset + 8 <= buffer.length) {
    const binLength = buffer.readUInt32LE(binOffset);
    if (buffer.readUInt32LE(binOffset + 4) !== BIN_CHUNK) {
      throw new Error("The second GLB chunk is not BIN.");
    }
    bin = buffer.subarray(binOffset + 8, binOffset + 8 + binLength);
  }
  return { json, bin };
}

/** Serialize a JSON document and binary chunk as GLB 2.0 with 4-byte padding. */
export function writeGlb(json, bin) {
  const rawJson = Buffer.from(JSON.stringify(json), "utf8");
  const jsonChunk = Buffer.concat([
    rawJson,
    Buffer.alloc(-rawJson.length & 3, 0x20),
  ]);
  const binChunk = Buffer.concat([bin, Buffer.alloc(-bin.length & 3)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(
    12 + 8 + jsonChunk.length + (binChunk.length ? 8 + binChunk.length : 0),
    8,
  );
  const chunkHeader = (length, type) => {
    const value = Buffer.alloc(8);
    value.writeUInt32LE(length, 0);
    value.writeUInt32LE(type, 4);
    return value;
  };
  const parts = [header, chunkHeader(jsonChunk.length, JSON_CHUNK), jsonChunk];
  if (binChunk.length)
    parts.push(chunkHeader(binChunk.length, BIN_CHUNK), binChunk);
  return Buffer.concat(parts);
}

/** The bytes of a buffer view in the binary chunk. */
export function viewBytes(document, viewIndex) {
  const view = document.json.bufferViews[viewIndex];
  const start = view.byteOffset ?? 0;
  return document.bin.subarray(start, start + view.byteLength);
}

/**
 * An accessor's elements as tightly packed bytes, applying a base view's
 * stride and any sparse substitution; a missing base view reads as zeros.
 */
export function denseAccessorBytes(document, accessor) {
  const elementSize =
    COMPONENT_SIZE[accessor.componentType] * TYPE_COMPONENTS[accessor.type];
  const out = Buffer.alloc(accessor.count * elementSize);
  if (accessor.bufferView !== undefined) {
    const view = viewBytes(document, accessor.bufferView);
    const stride =
      document.json.bufferViews[accessor.bufferView].byteStride ?? elementSize;
    const offset = accessor.byteOffset ?? 0;
    for (let index = 0; index < accessor.count; index += 1) {
      const start = offset + index * stride;
      view.copy(out, index * elementSize, start, start + elementSize);
    }
  }
  if (accessor.sparse) {
    const { count, indices, values } = accessor.sparse;
    const indexBytes = viewBytes(document, indices.bufferView).subarray(
      indices.byteOffset ?? 0,
    );
    const valueBytes = viewBytes(document, values.bufferView).subarray(
      values.byteOffset ?? 0,
    );
    const readIndex = {
      5121: (at) => indexBytes.readUInt8(at),
      5123: (at) => indexBytes.readUInt16LE(at * 2),
      5125: (at) => indexBytes.readUInt32LE(at * 4),
    }[indices.componentType];
    for (let at = 0; at < count; at += 1) {
      valueBytes.copy(
        out,
        readIndex(at) * elementSize,
        at * elementSize,
        (at + 1) * elementSize,
      );
    }
  }
  return out;
}

/** Build a binary chunk from parts, giving each a 4-byte aligned buffer view. */
export class BinaryBuilder {
  constructor() {
    this.parts = [];
    this.length = 0;
    this.views = [];
  }

  /** Append bytes as a new buffer view; `extra` keeps fields such as byteStride or target. */
  add(bytes, extra = {}) {
    const padding = -this.length & 3;
    if (padding) {
      this.parts.push(Buffer.alloc(padding));
      this.length += padding;
    }
    this.views.push({
      ...extra,
      buffer: 0,
      byteOffset: this.length,
      byteLength: bytes.length,
    });
    this.parts.push(bytes);
    this.length += bytes.length;
    return this.views.length - 1;
  }

  toBuffer() {
    return Buffer.concat(this.parts);
  }
}
