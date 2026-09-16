import { writeFileSync } from "node:fs";

// Original synthetic test data: two hips translations over one second. No
// captured movement, model, or third-party animation is used by this generator.
const values = [0, 1, 0, 1, 0, 0, 1.25, 0];
const binary = Buffer.alloc(values.length * 4);
values.forEach((value, index) => binary.writeFloatLE(value, index * 4));
const document = {
  asset: { version: "2.0", generator: "Animama synthetic VRMA fixture" },
  extensionsUsed: ["VRMC_vrm_animation"],
  extensions: {
    VRMC_vrm_animation: {
      specVersion: "1.0",
      humanoid: { humanBones: { hips: { node: 0 } } },
    },
  },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "hips", translation: [0, 1, 0] }],
  buffers: [{ byteLength: binary.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 8 },
    { buffer: 0, byteOffset: 8, byteLength: 24 },
  ],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 2,
      type: "SCALAR",
      min: [0],
      max: [1],
    },
    { bufferView: 1, componentType: 5126, count: 2, type: "VEC3" },
  ],
  animations: [
    {
      name: "synthetic-hips-rise",
      samplers: [{ input: 0, output: 1, interpolation: "LINEAR" }],
      channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
    },
  ],
};
const json = Buffer.from(JSON.stringify(document));
const paddedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
json.copy(paddedJson);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // glTF
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + paddedJson.length + 8 + binary.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(paddedJson.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4); // JSON
const binaryHeader = Buffer.alloc(8);
binaryHeader.writeUInt32LE(binary.length, 0);
binaryHeader.writeUInt32LE(0x004e4942, 4); // BIN
writeFileSync(
  new URL("synthetic-hips.vrma", import.meta.url),
  Buffer.concat([header, jsonHeader, paddedJson, binaryHeader, binary]),
);
