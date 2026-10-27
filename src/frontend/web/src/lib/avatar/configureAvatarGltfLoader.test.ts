import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAvatarGltfLoader } from "./avatarGltfLoader";
import { configureAvatarGltfLoader } from "./configureAvatarGltfLoader";
import { loadHeadlessVrm } from "./motion-authoring/headlessVrm";
import { encodeGlb } from "./testing/glb";

const POSITIONS = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const INDICES = [0, 1, 2];

/**
 * meshoptimizer's vertex codec, version 0, in its simplest valid form: one
 * block whose byte groups are all stored raw (`bitslog2` 3) as zigzag deltas
 * from the previous vertex, then the first vertex as the tail (at least 32
 * bytes). Real encoders pack smaller; the decoder accepts either.
 */
function encodeMeshoptAttributes(data: Uint8Array, stride: number) {
  const count = data.length / stride;
  const aligned = Math.ceil(count / 16) * 16;
  const groups = aligned / 16;
  const out: number[] = [0xa0];
  for (let byte = 0; byte < stride; byte += 1) {
    const header = new Array<number>(Math.ceil(groups / 4)).fill(0);
    for (let group = 0; group < groups; group += 1) {
      header[group >> 2] |= 3 << ((group & 3) * 2);
    }
    out.push(...header);
    const deltas = new Array<number>(aligned).fill(0);
    let previous = data[byte];
    for (let vertex = 0; vertex < count; vertex += 1) {
      const value = data[vertex * stride + byte];
      const delta = (value - previous) & 0xff;
      deltas[vertex] = ((delta << 1) ^ (delta & 0x80 ? 0xff : 0)) & 0xff;
      previous = value;
    }
    out.push(...deltas);
  }
  const tail = Math.max(32, stride);
  out.push(...new Array<number>(tail - stride).fill(0));
  out.push(...data.subarray(0, stride));
  return Uint8Array.from(out);
}

/**
 * meshoptimizer's index sequence codec (mode INDICES): each index is a
 * zigzag delta from the last one, with the low bit choosing baseline 0, one
 * byte each for small deltas, then a four-byte tail.
 */
function encodeMeshoptIndexSequence(indices: readonly number[]) {
  const out: number[] = [0xd1];
  let last = 0;
  for (const index of indices) {
    const delta = index - last;
    const zigzag = delta >= 0 ? delta * 2 : -delta * 2 - 1;
    if (zigzag * 2 >= 0x80) throw new Error("Use small deltas only");
    out.push(zigzag * 2);
    last = index;
  }
  out.push(0, 0, 0, 0);
  return Uint8Array.from(out);
}

/**
 * One triangle whose positions and indices are stored only in
 * `EXT_meshopt_compression` form: the uncompressed buffer is a fallback with
 * no data, so the file needs the decoder (`extensionsRequired`).
 */
function meshoptTriangleGlb(extra: Record<string, unknown> = {}) {
  const positions = encodeMeshoptAttributes(
    new Uint8Array(new Float32Array(POSITIONS).buffer),
    12,
  );
  const indices = encodeMeshoptIndexSequence(INDICES);
  const indexOffset = Math.ceil(positions.length / 4) * 4;
  const bin = new Uint8Array(indexOffset + indices.length);
  bin.set(positions);
  bin.set(indices, indexOffset);
  const compressed = (byteOffset: number, byteLength: number) => ({
    buffer: 0,
    byteOffset,
    byteLength,
  });
  return encodeGlb(
    {
      asset: { version: "2.0" },
      extensionsUsed: ["EXT_meshopt_compression"],
      extensionsRequired: ["EXT_meshopt_compression"],
      buffers: [
        { byteLength: Math.ceil(bin.length / 4) * 4 },
        {
          byteLength: 44,
          extensions: { EXT_meshopt_compression: { fallback: true } },
        },
      ],
      bufferViews: [
        {
          buffer: 1,
          byteOffset: 0,
          byteLength: 36,
          extensions: {
            EXT_meshopt_compression: {
              ...compressed(0, positions.length),
              byteStride: 12,
              count: 3,
              mode: "ATTRIBUTES",
            },
          },
        },
        {
          buffer: 1,
          byteOffset: 36,
          byteLength: 6,
          extensions: {
            EXT_meshopt_compression: {
              ...compressed(indexOffset, indices.length),
              byteStride: 2,
              count: 3,
              mode: "INDICES",
            },
          },
        },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
        { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      ...extra,
    },
    bin,
  ).buffer as ArrayBuffer;
}

/** The single triangle mesh of a loaded scene. */
function onlyMesh(scene: THREE.Object3D): THREE.Mesh {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  expect(meshes).toHaveLength(1);
  return meshes[0]!;
}

beforeEach(() => {
  // three warns about unknown required extensions; the tests assert outcomes.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("configureAvatarGltfLoader", () => {
  it("loads a meshopt-compressed file through the Avatar loader", async () => {
    const gltf = await createAvatarGltfLoader().parseAsync(
      meshoptTriangleGlb(),
      "",
    );
    const geometry = onlyMesh(gltf.scene).geometry;
    expect(Array.from(geometry.getAttribute("position").array)).toEqual(
      POSITIONS,
    );
    expect(Array.from(geometry.getIndex()!.array)).toEqual(INDICES);
  });

  it("is what a plain loader lacks for meshopt", async () => {
    await expect(
      new GLTFLoader().parseAsync(meshoptTriangleGlb(), ""),
    ).rejects.toThrow(/setMeshoptDecoder/);
    const gltf = await configureAvatarGltfLoader(new GLTFLoader()).parseAsync(
      meshoptTriangleGlb(),
      "",
    );
    expect(onlyMesh(gltf.scene).geometry.getIndex()!.count).toBe(3);
  });

  it("refuses a file requiring an extension three would skip, naming it", async () => {
    const unknown = meshoptTriangleGlb({
      extensionsUsed: ["EXT_meshopt_compression", "EXT_unknown_test"],
      extensionsRequired: ["EXT_meshopt_compression", "EXT_unknown_test"],
    });
    // three alone draws the file without it.
    await expect(
      new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .parseAsync(unknown, ""),
    ).resolves.toBeTruthy();
    await expect(
      createAvatarGltfLoader().parseAsync(unknown, ""),
    ).rejects.toThrow(/EXT_unknown_test/);
  });

  it("fails a Draco file instead of drawing part of it", async () => {
    const draco = encodeGlb({
      asset: { version: "2.0" },
      extensionsUsed: ["KHR_draco_mesh_compression"],
      extensionsRequired: ["KHR_draco_mesh_compression"],
      meshes: [{ primitives: [{ attributes: {} }] }],
    }).buffer as ArrayBuffer;
    await expect(
      createAvatarGltfLoader().parseAsync(draco, ""),
    ).rejects.toThrow();
    await expect(loadHeadlessVrm(draco)).rejects.toThrow();
  });
});
