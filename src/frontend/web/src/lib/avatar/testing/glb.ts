/**
 * A synthetic GLB holding `json` and an optional binary chunk, each padded to
 * four bytes as the container requires.
 */
export function encodeGlb(json: unknown, bin?: Uint8Array): Uint8Array {
  const pad = (bytes: Uint8Array, fill: number) => {
    const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(fill);
    padded.set(bytes);
    return padded;
  };
  const jsonChunk = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binChunk = bin ? pad(bin, 0) : null;
  const length =
    12 + 8 + jsonChunk.length + (binChunk ? 8 + binChunk.length : 0);
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, length, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonChunk, 20);
  if (binChunk) {
    const at = 20 + jsonChunk.length;
    view.setUint32(at, binChunk.length, true);
    view.setUint32(at + 4, 0x004e4942, true); // "BIN\0"
    out.set(binChunk, at + 8);
  }
  return out;
}
