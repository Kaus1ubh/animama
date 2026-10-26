import { describe, expect, it } from "vitest";

import {
  readTestAvatarBytes,
  VRM0_FIXTURE_ID,
} from "../motion-authoring/testing/includedAvatars";
import { readAvatarFileFacts, readImagePixelSize } from "./avatarFileFacts";

/** A GLB holding `json` and an optional binary chunk. */
function glb(json: unknown, bin?: Uint8Array): Uint8Array {
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
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, length, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonChunk, 20);
  if (binChunk) {
    const at = 20 + jsonChunk.length;
    view.setUint32(at, binChunk.length, true);
    view.setUint32(at + 4, 0x004e4942, true);
    out.set(binChunk, at + 8);
  }
  return out;
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, an APP0 segment to skip, then a baseline start-of-frame.
  const bytes = new Uint8Array(2 + 18 + 19);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xffd8);
  view.setUint16(2, 0xffe0);
  view.setUint16(4, 16);
  view.setUint16(20, 0xffc0);
  view.setUint16(22, 17);
  bytes[24] = 8;
  view.setUint16(25, height);
  view.setUint16(27, width);
  return bytes;
}

function webpExtended(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 10, true);
  const uint24 = (at: number, value: number) =>
    bytes.set([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff], at);
  uint24(24, width - 1);
  uint24(27, height - 1);
  return bytes;
}

describe("readAvatarFileFacts", () => {
  it.each(["Andrew", "AvatarSample_A_1_New"] as const)(
    "describes the Included Avatar %s",
    async (id) => {
      const facts = readAvatarFileFacts(await readTestAvatarBytes(id));
      expect(facts).toMatchObject({ container: "glb", vrmVersion: "1.0" });
      expect(facts!.extensionsUsed).toContain("VRMC_vrm");
      expect(facts!.primitiveCount).toBeGreaterThan(facts!.meshCount);
      expect(facts!.morphedPrimitiveCount).toBeGreaterThan(0);
      expect(facts!.materialKinds.mtoon).toBeGreaterThan(0);
      expect(facts!.textures.length).toBeGreaterThan(0);
      for (const texture of facts!.textures) {
        expect(texture.byteLength).toBeGreaterThan(0);
        expect(texture.width).toBeGreaterThan(0);
        expect(texture.height).toBeGreaterThan(0);
      }
    },
  );

  it("reads a VRM 0 file's version and MToon materials", async () => {
    const facts = readAvatarFileFacts(
      await readTestAvatarBytes(VRM0_FIXTURE_ID),
    );
    expect(facts?.vrmVersion).toBe("0.x");
    expect(facts?.materialKinds.mtoon).toBeGreaterThan(0);
  });

  it("describes a file whose required extension no loader decodes", () => {
    const image = png(512, 256);
    const facts = readAvatarFileFacts(
      glb(
        {
          asset: { version: "2.0" },
          extensionsUsed: ["KHR_draco_mesh_compression", "KHR_materials_unlit"],
          extensionsRequired: ["KHR_draco_mesh_compression"],
          meshes: [{ primitives: [{ targets: [{}] }, {}] }],
          materials: [{ extensions: { KHR_materials_unlit: {} } }, {}],
          bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: image.length }],
          images: [
            { bufferView: 0, mimeType: "image/png" },
            { uri: "textures/outside.png" },
          ],
        },
        image,
      ),
    );
    expect(facts).toMatchObject({
      vrmVersion: null,
      extensionsRequired: ["KHR_draco_mesh_compression"],
      meshCount: 1,
      primitiveCount: 2,
      morphedPrimitiveCount: 1,
      materialCount: 2,
      materialKinds: { mtoon: 0, liltoon: 0, unlit: 1, pbr: 1 },
      textures: [
        {
          mimeType: "image/png",
          byteLength: image.length,
          width: 512,
          height: 256,
        },
        { mimeType: null, byteLength: null, width: null, height: null },
      ],
    });
  });

  it("reads lilToon materials and data URI images", () => {
    const image = jpeg(64, 32);
    const uri = `data:image/jpeg;base64,${btoa(String.fromCharCode(...image))}`;
    const facts = readAvatarFileFacts(
      glb({
        extensions: { VRMC_vrm: { specVersion: "1.0" } },
        materials: [{ extensions: { MOCHIYA_materials_liltoon: {} } }],
        images: [{ uri, mimeType: "image/jpeg" }],
      }),
    );
    expect(facts?.materialKinds.liltoon).toBe(1);
    expect(facts?.textures[0]).toMatchObject({ width: 64, height: 32 });
  });

  it("keeps the JSON facts of a file cut off in its binary chunk", () => {
    const image = png(8, 8);
    const full = glb(
      {
        meshes: [{ primitives: [{}] }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: image.length },
          { buffer: 0, byteOffset: -4, byteLength: 4 },
        ],
        images: [{ bufferView: 0 }, { bufferView: 1 }],
      },
      image,
    );
    const facts = readAvatarFileFacts(full.slice(0, full.length - 8));
    expect(facts).toMatchObject({ meshCount: 1, primitiveCount: 1 });
    // No binary chunk survived, so no image size is claimed.
    expect(facts!.textures.map((texture) => texture.byteLength)).toEqual([
      null,
      null,
    ]);
    // A bad offset never reads from the wrong place.
    expect(readAvatarFileFacts(full)!.textures[1]!.byteLength).toBeNull();
  });

  it("returns null for bytes that are not glTF", () => {
    expect(
      readAvatarFileFacts(new TextEncoder().encode("not a model")),
    ).toBeNull();
    const truncated = glb({ asset: {} }).slice(0, 24);
    expect(readAvatarFileFacts(truncated)).toBeNull();
  });
});

describe("readImagePixelSize", () => {
  it("reads PNG, JPEG and WebP headers", () => {
    expect(readImagePixelSize(png(2048, 1024))).toEqual({
      width: 2048,
      height: 1024,
    });
    expect(readImagePixelSize(jpeg(640, 480))).toEqual({
      width: 640,
      height: 480,
    });
    expect(readImagePixelSize(webpExtended(4096, 2048))).toEqual({
      width: 4096,
      height: 2048,
    });
  });

  it("returns null for other formats", () => {
    expect(readImagePixelSize(new Uint8Array(40))).toBeNull();
  });
});
