import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "../Avatar";
import {
  VRM0_FIXTURE_ID,
  type TestAvatarId,
} from "../motion-authoring/testing/includedAvatars";
import { appendTriangle } from "../testing/appendTriangle";
import { loadedTestAvatar } from "../testing/loadedTestAvatar";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";
import { AvatarVFXController } from "./AvatarVFXController";
import type { RuntimePrimitiveBindingEntry } from "./avatarPrimitiveUtils";
import { loadEffectImage } from "./effect-image";
import { dilateClipTriangles, traceClipTriangles } from "./faceSkinClip";
import { baseTextureOf } from "./textureUvMapping";
import type { AvatarVFXCatalogEntry } from "./types";

vi.mock("./effect-image", () => ({ loadEffectImage: vi.fn() }));

const TEXTURE_SIZE = 1024;

/**
 * A canvas that records what each context does: the triangles traced before
 * every `clip()`, and the order of base draws, clips, clears and art draws.
 */
class RecordingCanvas {
  width = TEXTURE_SIZE;
  height = TEXTURE_SIZE;
  clips: number[][][] = [];
  operations: string[] = [];
  /** The image counted as the original texture in `operations`. */
  static base: unknown = null;

  getContext() {
    let triangles: number[][] = [];
    let current: number[] = [];
    const state = {
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      fillStyle: "",
    };
    return Object.assign(state, {
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      rect: () => {},
      arc: () => {},
      fill: () => {},
      fillRect: () => {},
      clearRect: () => this.operations.push("clear"),
      beginPath: () => {
        triangles = [];
        current = [];
      },
      moveTo: (x: number, y: number) => {
        current = [x, y];
      },
      lineTo: (x: number, y: number) => {
        current.push(x, y);
      },
      closePath: () => {
        triangles.push(current);
        current = [];
      },
      clip: () => {
        this.clips.push(triangles);
        this.operations.push("clip");
      },
      drawImage: (image: unknown) =>
        this.operations.push(image === RecordingCanvas.base ? "base" : "draw"),
      getImageData: () => ({
        data: new Uint8ClampedArray([220, 190, 160, 255]),
      }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
    });
  }
}

const created: RecordingCanvas[] = [];

const fullFace = (
  applyMode: "overlay" | "replace" = "overlay",
): AvatarVFXCatalogEntry => ({
  id: "full-face",
  label: "Full face",
  description: "",
  assetPath: "blob:full-face",
  region: "full_face",
  transform: {
    offset: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  },
  kind: "texture",
  targetRole: "face_skin",
  assetShape: "full_face",
  applyMode,
});

function entryOf(avatar: Avatar, key: string): RuntimePrimitiveBindingEntry {
  return buildRuntimePrimitiveBindings(avatar).entries.find(
    (entry) => entry.bindingKey === key,
  )!;
}

function faceEntry(avatar: Avatar): RuntimePrimitiveBindingEntry {
  return entryOf(avatar, avatar.facePartMap!.parts.face_skin.bindings[0]!);
}

/**
 * Give the face texture an image the compositor can draw, apply whole-face
 * art, and return the clips the composite drew it through.
 */
async function applyFullFace(
  avatar: Avatar,
  applyMode: "overlay" | "replace" = "overlay",
): Promise<number[][][]> {
  const texture = baseTextureOf(faceEntry(avatar).object)!;
  texture.image = new RecordingCanvas();
  RecordingCanvas.base = texture.image;
  const controller = new AvatarVFXController(avatar);
  const effect = fullFace(applyMode);
  await controller.applyEffect({
    bindingKey: faceEntry(avatar).bindingKey,
    effectId: effect.id,
    effectEntry: effect,
  });
  expect(created.some((canvas) => canvas.operations.includes("draw"))).toBe(
    true,
  );
  return created.flatMap((canvas) => canvas.clips);
}

/** Whether a pixel point lies inside any of the traced triangles. */
function covers(triangles: number[][], x: number, y: number): boolean {
  const point = new THREE.Vector3(x, y, 0);
  return triangles.some((corners) =>
    new THREE.Triangle(
      new THREE.Vector3(corners[0], corners[1], 0),
      new THREE.Vector3(corners[2], corners[3], 0),
      new THREE.Vector3(corners[4], corners[5], 0),
    ).containsPoint(point),
  );
}

/** Centroids, in texture pixels, of a primitive's first non-degenerate triangles. */
function triangleCentroids(
  entry: RuntimePrimitiveBindingEntry,
  count: number,
  keep: (vertices: number[]) => boolean = () => true,
): [number, number][] {
  const geometry = entry.object.geometry;
  const index = geometry.getIndex()!;
  const uv = geometry.getAttribute("uv");
  const centroids: [number, number][] = [];
  for (let offset = 0; offset + 2 < index.count; offset += 3) {
    const vertices = [0, 1, 2].map((corner) => index.getX(offset + corner));
    const corners = vertices.map(
      (vertex) => new THREE.Vector2(uv.getX(vertex), uv.getY(vertex)),
    );
    const area = Math.abs(
      (corners[1]!.x - corners[0]!.x) * (corners[2]!.y - corners[0]!.y) -
        (corners[2]!.x - corners[0]!.x) * (corners[1]!.y - corners[0]!.y),
    );
    if (area < 1e-8 || !keep(vertices)) continue;
    const centroid = corners
      .reduce((sum, corner) => sum.add(corner), new THREE.Vector2())
      .multiplyScalar(TEXTURE_SIZE / 3);
    centroids.push([centroid.x, centroid.y]);
    if (centroids.length === count) break;
  }
  return centroids;
}

/**
 * A small triangle in an eye hole of the VRoid face island, a part of
 * the texture no face skin triangle maps (at least 16 px from one at the
 * test's texture size), and the pixel at its centre.
 */
const HOLE_UV: [[number, number], [number, number], [number, number]] = [
  [0.339, 0.543],
  [0.349, 0.543],
  [0.344, 0.552],
];
const HOLE_PIXEL: [number, number] = [
  0.344 * TEXTURE_SIZE,
  0.546 * TEXTURE_SIZE,
];

/**
 * The glTF images a material shows as its base or shade colour (glTF and
 * MToon 1 slots, VRM 0 texture properties).
 */
function colourImages(avatar: Avatar, material: number): number[] {
  const json = avatar.sourceGltf!.parser.json as {
    materials: {
      pbrMetallicRoughness?: { baseColorTexture?: { index: number } };
      extensions?: {
        VRMC_materials_mtoon?: { shadeMultiplyTexture?: { index: number } };
      };
    }[];
    textures: { source?: number }[];
    extensions?: {
      VRM?: { materialProperties?: { textureProperties?: object }[] };
    };
  };
  const entry = json.materials[material]!;
  const v0 = json.extensions?.VRM?.materialProperties?.[material]
    ?.textureProperties as Record<string, number> | undefined;
  return [
    entry.pbrMetallicRoughness?.baseColorTexture?.index,
    entry.extensions?.VRMC_materials_mtoon?.shadeMultiplyTexture?.index,
    v0?._MainTex,
    v0?._ShadeTexture,
  ]
    .filter((index): index is number => index !== undefined)
    .map((index) => json.textures[index]!.source!);
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  created.length = 0;
  vi.stubGlobal("HTMLCanvasElement", RecordingCanvas);
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas = new RecordingCanvas();
      created.push(canvas);
      return canvas;
    },
  });
  vi.mocked(loadEffectImage).mockImplementation(
    async () => new RecordingCanvas() as unknown as HTMLCanvasElement,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("whole-face art on the face skin's texture", () => {
  it.each<TestAvatarId>(["Andrew", "AvatarSample_A_1_New", VRM0_FIXTURE_ID])(
    "covers %s's whole face texture, as before",
    async (id) => {
      const avatar = await loadedTestAvatar(id);
      // Headless textures do not share images across texture entries, so
      // the file itself shows no other material draws the face's images.
      const face = faceEntry(avatar).materialIndex!;
      const faceImages = colourImages(avatar, face);
      const materials = (avatar.sourceGltf!.parser.json.materials as unknown[])
        .length;
      for (let material = 0; material < materials; material += 1) {
        if (material === face) continue;
        for (const image of colourImages(avatar, material)) {
          expect(faceImages).not.toContain(image);
        }
      }

      expect(await applyFullFace(avatar)).toEqual([]);
    },
  );

  it("covers only the face skin's triangles on a texture atlas", async () => {
    const avatar = await loadedTestAvatar("AvatarSample_A_1_New");
    const face = faceEntry(avatar);
    // The mouth primitive draws from the face's texture, as on an atlas, with
    // a triangle in a corner the face does not use.
    const mouth = buildRuntimePrimitiveBindings(avatar).entries.find((entry) =>
      entry.materialName?.includes("FaceMouth"),
    )!;
    const mouthMaterial = mouth.object.material as THREE.MeshBasicMaterial;
    mouthMaterial.map = baseTextureOf(face.object);
    appendTriangle({
      avatar,
      binding: mouth,
      anchor: avatar.vrm!.humanoid.getNormalizedBoneNode("head")!,
      corners: [
        new THREE.Vector3(-0.002, 0, 0),
        new THREE.Vector3(0.002, 0, 0),
        new THREE.Vector3(0, 0.002, 0),
      ],
      uv: HOLE_UV,
    });

    // One clip per colour slot (map and shade texture), both the same.
    const clips = await applyFullFace(avatar);
    expect(clips).toHaveLength(2);
    for (const clip of clips) {
      for (const [x, y] of triangleCentroids(face, 50)) {
        expect(covers(clip, x, y)).toBe(true);
      }
      expect(covers(clip, ...HOLE_PIXEL)).toBe(false);
    }
  });

  it("keeps a shared texture's other parts under a replacement", async () => {
    const avatar = await loadedTestAvatar("AvatarSample_A_1_New");
    const mouth = buildRuntimePrimitiveBindings(avatar).entries.find((entry) =>
      entry.materialName?.includes("FaceMouth"),
    )!;
    (mouth.object.material as THREE.MeshBasicMaterial).map = baseTextureOf(
      faceEntry(avatar).object,
    );

    expect(await applyFullFace(avatar, "replace")).toHaveLength(2);
    // The original texture, then the face's region cleared and replaced.
    const operations = created.find((canvas) =>
      canvas.operations.includes("clip"),
    )!.operations;
    const base = operations.indexOf("base");
    const clip = operations.indexOf("clip", base);
    const clear = operations.indexOf("clear", clip);
    const draw = operations.indexOf("draw", clear);
    expect(base).toBeGreaterThanOrEqual(0);
    expect([clip, clear, draw].every((index) => index > base)).toBe(true);
  });

  it("leaves out the neck of a face primitive that holds it", async () => {
    const avatar = await loadedTestAvatar("Andrew");
    const face = faceEntry(avatar);
    const mesh = face.object as THREE.SkinnedMesh;
    const neck = mesh.skeleton.bones.indexOf(
      avatar.vrm!.humanoid.getRawBoneNode("neck")! as THREE.Bone,
    );
    const chin = avatar.getFaceLandmarksSnapshot()!.faceBoundsLocal!.min.y;
    // A neck triangle below the chin, skinned to the neck...
    appendTriangle({
      avatar,
      binding: face,
      anchor: avatar.vrm!.humanoid.getNormalizedBoneNode("head")!,
      corners: [
        new THREE.Vector3(-0.06, chin - 0.12, 0),
        new THREE.Vector3(0.06, chin - 0.12, 0),
        new THREE.Vector3(0, chin - 0.01, 0),
      ],
      uv: HOLE_UV,
      joint: neck,
    });
    // ...and enough neck-weighted vertices that under 90% of the weight is
    // on the head (as in the face parts test of a face skinned to the neck).
    const skinIndex = mesh.geometry.getAttribute("skinIndex");
    const skinWeight = mesh.geometry.getAttribute("skinWeight");
    const reweighted = Math.ceil(skinIndex.count * 0.2);
    for (let vertex = 0; vertex < reweighted; vertex += 1) {
      skinIndex.setXYZW(vertex, neck, 0, 0, 0);
      skinWeight.setXYZW(vertex, 1, 0, 0, 0);
    }
    await avatar.setFacePartCorrections(null);

    const clips = await applyFullFace(avatar);
    expect(clips).toHaveLength(2);
    const head = triangleCentroids(face, 50, (vertices) =>
      vertices.every((vertex) => vertex >= reweighted),
    );
    expect(head).toHaveLength(50);
    for (const clip of clips) {
      for (const [x, y] of head) {
        expect(covers(clip, x, y)).toBe(true);
      }
      expect(covers(clip, ...HOLE_PIXEL)).toBe(false);
    }
  });
});

describe("clip triangles", () => {
  it("grow about 1.5 px past each edge", () => {
    // Image coordinates on a 10 × 10 texture: a right triangle 10 px a side.
    const grown = dilateClipTriangles(Float32Array.of(0, 0, 1, 0, 0, 1), {
      width: 10,
      height: 10,
    });
    const traced: number[][] = [];
    traceClipTriangles(
      {
        moveTo: (x, y) => traced.push([x, y]),
        lineTo: (x, y) => traced.at(-1)!.push(x, y),
        closePath: () => {},
      },
      grown,
    );
    expect(covers(traced, 5, -1)).toBe(true);
    expect(covers(traced, -1, 5)).toBe(true);
    expect(covers(traced, 5.5, 5.5)).toBe(true);
    expect(covers(traced, 5, -2.5)).toBe(false);
    expect(covers(traced, 6.5, 6.5)).toBe(false);
  });

  it("move a sliver's corners only a few pixels and drop a line", () => {
    const grown = dilateClipTriangles(
      Float32Array.of(0, 0, 100, 0, 50, 0.01, 0, 0, 1, 1, 2, 2),
      { width: 1, height: 1 },
    );
    expect(grown).toHaveLength(6);
    expect(grown[0]).toBeGreaterThan(-4.6);
    expect(grown[2]).toBeLessThan(104.6);
  });
});
