import { describe, expect, it } from "vitest";

import { loadHeadlessVrm } from "./headlessVrm";

const BONES = [
  "hips",
  "spine",
  "head",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
];

/** A VRM 1.0 GLB with one triangle mesh whose material uses a WebP-only texture. */
function webpTexturedVrm(): ArrayBuffer {
  const image = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const binary = new Uint8Array(image.length + positions.byteLength);
  binary.set(image);
  binary.set(new Uint8Array(positions.buffer), image.length);
  const json = {
    asset: { version: "2.0" },
    extensionsUsed: ["VRMC_vrm", "EXT_texture_webp"],
    extensionsRequired: ["EXT_texture_webp"],
    extensions: {
      VRMC_vrm: {
        specVersion: "1.0",
        meta: {
          name: "WebP fixture",
          authors: ["Animama"],
          licenseUrl: "https://vrm.dev/licenses/1.0/",
        },
        humanoid: {
          humanBones: Object.fromEntries(
            BONES.map((bone, node) => [bone, { node }]),
          ),
        },
      },
    },
    nodes: [...BONES.map((name) => ({ name })), { name: "Body", mesh: 0 }],
    scenes: [{ nodes: [...BONES.map((_, node) => node), BONES.length] }],
    scene: 0,
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: image.length },
      {
        buffer: 0,
        byteOffset: image.length,
        byteLength: positions.byteLength,
      },
    ],
    accessors: [
      {
        bufferView: 1,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    images: [{ bufferView: 0, mimeType: "image/webp" }],
    textures: [{ extensions: { EXT_texture_webp: { source: 0 } } }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    meshes: [
      {
        primitives: [{ attributes: { POSITION: 0 }, material: 0 }],
      },
    ],
  };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonChunk = new Uint8Array(Math.ceil(encoded.length / 4) * 4).fill(
    0x20,
  );
  jsonChunk.set(encoded);
  const total = 12 + 8 + jsonChunk.length + 8 + binary.length;
  const glb = new Uint8Array(total);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  glb.set(jsonChunk, 20);
  view.setUint32(20 + jsonChunk.length, binary.length, true);
  view.setUint32(24 + jsonChunk.length, 0x004e4942, true);
  glb.set(binary, 28 + jsonChunk.length);
  return glb.buffer;
}

describe("loadHeadlessVrm", () => {
  it("loads a VRM whose textures require EXT_texture_webp", async () => {
    const vrm = await loadHeadlessVrm(webpTexturedVrm());

    expect(vrm.humanoid.getRawBoneNode("head")?.name).toBe("head");
  });
});
