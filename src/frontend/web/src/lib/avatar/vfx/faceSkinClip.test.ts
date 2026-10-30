import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "../Avatar";
import {
  VRM0_FIXTURE_ID,
  type TestAvatarId,
} from "../motion-authoring/testing/includedAvatars";
import { appendTriangle } from "../testing/appendTriangle";
import { addBlinkStrand } from "../testing/blinkStrand";
import { loadedTestAvatar } from "../testing/loadedTestAvatar";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";
import { AvatarVFXController } from "./AvatarVFXController";
import type { RuntimePrimitiveBindingEntry } from "./avatarPrimitiveUtils";
import { loadEffectImage } from "./effect-image";
import {
  collectFaceSkinClipTriangles,
  dilateClipTriangles,
  traceClipTriangles,
} from "./faceSkinClip";
import { PrimitiveRegionHider } from "./primitiveRegionHiding";
import { baseTextureOf } from "./textureUvMapping";
import type { AvatarVFXCatalogEntry } from "./types";

vi.mock("./effect-image", () => ({ loadEffectImage: vi.fn() }));

const TEXTURE_SIZE = 1024;

/** A `Path2D` that keeps its triangles, one array of corners per subpath. */
class RecordingPath {
  triangles: number[][] = [];
  moveTo(x: number, y: number) {
    this.triangles.push([x, y]);
  }
  lineTo(x: number, y: number) {
    this.triangles.at(-1)!.push(x, y);
  }
  closePath() {}
}

/**
 * A canvas that records what each context does: the triangles of each path
 * it clips with, and the order of base draws, clips, clears and art draws.
 */
class RecordingCanvas {
  width = TEXTURE_SIZE;
  height = TEXTURE_SIZE;
  clips: number[][][] = [];
  operations: string[] = [];
  /** The image counted as the original texture in `operations`. */
  static base: unknown = null;

  getContext() {
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
      beginPath: () => {},
      clearRect: () => this.operations.push("clear"),
      clip: (path: RecordingPath) => {
        this.clips.push(path.triangles);
        this.operations.push("clip");
      },
      // The original drawn whole is the base; a patch of it is a skin sample.
      drawImage: (image: unknown, ...args: number[]) =>
        this.operations.push(
          image !== RecordingCanvas.base
            ? "draw"
            : args.length === 4
              ? "base"
              : "sample",
        ),
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
  id = "full-face",
): AvatarVFXCatalogEntry => ({
  id,
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
 * art (`effects`, in order), and return the clips the composites drew with.
 */
async function applyFullFace(
  avatar: Avatar,
  effects: AvatarVFXCatalogEntry[] = [fullFace()],
): Promise<number[][][]> {
  created.length = 0;
  const texture = baseTextureOf(faceEntry(avatar).object)!;
  texture.image = new RecordingCanvas();
  RecordingCanvas.base = texture.image;
  const controller = new AvatarVFXController(avatar);
  for (const effect of effects) {
    await controller.applyEffect({
      bindingKey: faceEntry(avatar).bindingKey,
      effectId: effect.id,
      effectEntry: effect,
    });
  }
  expect(created.some((canvas) => canvas.operations.includes("draw"))).toBe(
    true,
  );
  return created.flatMap((canvas) => canvas.clips);
}

/** The FaceMouth primitive drawing from the face's texture, as on an atlas. */
function shareFaceTexture(avatar: Avatar): RuntimePrimitiveBindingEntry {
  const mouth = buildRuntimePrimitiveBindings(avatar).entries.find((entry) =>
    entry.materialName?.includes("FaceMouth"),
  )!;
  (mouth.object.material as THREE.MeshBasicMaterial).map = baseTextureOf(
    faceEntry(avatar).object,
  );
  return mouth;
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
/** The same in the other eye hole. */
const OTHER_HOLE_UV: [[number, number], [number, number], [number, number]] = [
  [0.651, 0.543],
  [0.661, 0.543],
  [0.656, 0.552],
];
const OTHER_HOLE_PIXEL: [number, number] = [
  0.656 * TEXTURE_SIZE,
  0.546 * TEXTURE_SIZE,
];

/**
 * Annie with an inner mouth and lash strands kept inside her face primitive,
 * on its own texture as a converted Avatar has them: the mouth an island
 * behind the lips, mapped into one eye hole of the face texture, the lashes
 * blink regions mapped into the other.
 */
async function annieWithInnerParts(): Promise<Avatar> {
  const avatar = await loadedTestAvatar("Annie");
  const face = faceEntry(avatar);
  const { left, right } = avatar.getFaceLandmarksSnapshot()!.eyes;
  const eyes = [left!, right!].map((eye) =>
    new THREE.Vector3().copy(eye.centerLocal),
  );
  const y = eyes[0]!.y - 0.05;
  const z = eyes[0]!.z - 0.02;
  appendTriangle({
    avatar,
    binding: face,
    anchor: avatar.vrm!.humanoid.getNormalizedBoneNode("head")!,
    corners: [
      new THREE.Vector3(-0.004, y, z),
      new THREE.Vector3(0.004, y, z),
      new THREE.Vector3(0, y + 0.004, z),
    ],
    uv: HOLE_UV,
  });
  for (const eye of eyes) {
    addBlinkStrand(avatar, face, eye, 0.01, 0.012, OTHER_HOLE_UV);
  }
  await avatar.setFacePartCorrections(null);
  return avatar;
}

/** Centroids, in texture pixels, of a VRoid face's ear triangles. */
function earCentroids(entry: RuntimePrimitiveBindingEntry): [number, number][] {
  const position = entry.object.geometry.getAttribute("position");
  // The ears reach past the face island's outline (about ±0.087 m).
  return triangleCentroids(entry, 20, (vertices) =>
    vertices.every((vertex) => Math.abs(position.getX(vertex)) > 0.09),
  );
}

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
  vi.stubGlobal("Path2D", RecordingPath);
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
  it.each<TestAvatarId>(["Andrew", "Annie", VRM0_FIXTURE_ID])(
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
    const avatar = await loadedTestAvatar("Annie");
    const face = faceEntry(avatar);
    // The mouth primitive draws from the face's texture, with a triangle in
    // a part of it the face does not use.
    appendTriangle({
      avatar,
      binding: shareFaceTexture(avatar),
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
    const ears = earCentroids(face);
    expect(ears.length).toBeGreaterThan(0);
    for (const clip of clips) {
      for (const [x, y] of [...triangleCentroids(face, 50), ...ears]) {
        expect(covers(clip, x, y)).toBe(true);
      }
      expect(covers(clip, ...HOLE_PIXEL)).toBe(false);
    }
  });

  it("covers only the face island of a primitive holding an inner mouth and lashes", async () => {
    const avatar = await annieWithInnerParts();
    const face = faceEntry(avatar);
    expect(avatar.facePartMap!.parts.eyelash.regions).toMatchObject([
      { bindingKey: face.bindingKey },
    ]);

    // The face's own texture, all head-skinned: the inner parts alone call
    // for the clip.
    const clips = await applyFullFace(avatar);
    expect(clips).toHaveLength(2);
    for (const clip of clips) {
      for (const [x, y] of [
        ...triangleCentroids(face, 50),
        ...earCentroids(face),
      ]) {
        expect(covers(clip, x, y)).toBe(true);
      }
      expect(covers(clip, ...HOLE_PIXEL)).toBe(false);
      expect(covers(clip, ...OTHER_HOLE_PIXEL)).toBe(false);
    }
  });

  it("builds the same clip while an eye effect hides the lashes", async () => {
    const plain = await applyFullFace(await annieWithInnerParts());

    // Lash regions written as degenerate triangles when the clip is built.
    const avatar = await annieWithInnerParts();
    const face = faceEntry(avatar);
    const regions = avatar.facePartMap!.parts.eyelash.regions!;
    new PrimitiveRegionHider().hide(
      "eye-effect",
      face.object.geometry,
      regions.flatMap((region) => region.triangles),
    );

    expect(await applyFullFace(avatar)).toEqual(plain);
  });

  it("keeps a shared texture's other parts under a replacement", async () => {
    const avatar = await loadedTestAvatar("Annie");
    shareFaceTexture(avatar);

    await applyFullFace(avatar, [fullFace("replace")]);
    // The original texture, cleared inside the face's clip, then the art
    // drawn through the clip.
    const operations = created.find((canvas) =>
      canvas.operations.includes("base"),
    )!.operations;
    const base = operations.indexOf("base");
    const clip = operations.indexOf("clip", base);
    const clear = operations.indexOf("clear", clip);
    const draw = operations.indexOf("draw", clear);
    expect(base).toBeGreaterThanOrEqual(0);
    expect(clip).toBeGreaterThan(base);
    expect(clear).toBeGreaterThan(clip);
    expect(draw).toBeGreaterThan(clear);
  });

  it("hides the original under a replacement drawn after animated art", async () => {
    const avatar = await loadedTestAvatar("Annie");
    shareFaceTexture(avatar);
    const animated = fullFace("overlay", "animated");
    animated.keyframes = {
      loop: true,
      frames: [
        { t: 0, opacity: 1 },
        { t: 1, opacity: 0.5 },
      ],
    };

    // The replacement draws in a later static segment than the original.
    await applyFullFace(avatar, [animated, fullFace("replace", "replace")]);
    const segments = created.filter((canvas) =>
      canvas.operations.includes("base"),
    );
    expect(segments.length).toBeGreaterThan(0);
    for (const { operations } of segments) {
      const base = operations.indexOf("base");
      expect(operations.indexOf("clip", base)).toBeGreaterThan(base);
      expect(operations.indexOf("draw", base)).toBe(-1);
    }
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
  it("leave out part regions, whether or not they are hidden", async () => {
    const avatar = await loadedTestAvatar("Annie");
    const face = faceEntry(avatar);
    // Ten of the face's triangles taken as a lash region.
    const regions = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const collect = () =>
      collectFaceSkinClipTriangles({
        avatar,
        anchorObject: avatar.faceLandmarks!.getAnchorObject(),
        landmarks: avatar.getFaceLandmarksSnapshot(),
        sources: [
          {
            entry: face,
            texture: baseTextureOf(face.object)!,
            keepVertex: null,
            regions,
          },
        ],
      });
    const triangleCount = face.object.geometry.getIndex()!.count / 3;

    const plain = collect();
    expect(plain.complete).toBe(false);
    expect(plain.triangles).toHaveLength((triangleCount - regions.size) * 6);
    // An eye effect has the region written as degenerate triangles.
    new PrimitiveRegionHider().hide("eye-effect", face.object.geometry, [
      ...regions,
    ]);
    expect(collect()).toEqual(plain);
  });

  it("keep every triangle of a VRoid face, ears included", async () => {
    const avatar = await loadedTestAvatar("Andrew");
    const face = faceEntry(avatar);
    const { triangles, complete } = collectFaceSkinClipTriangles({
      avatar,
      anchorObject: avatar.faceLandmarks!.getAnchorObject(),
      landmarks: avatar.getFaceLandmarksSnapshot(),
      sources: [
        {
          entry: face,
          texture: baseTextureOf(face.object)!,
          keepVertex: null,
          regions: new Set(),
        },
      ],
    });
    expect(complete).toBe(true);
    expect(triangles).toHaveLength(face.object.geometry.getIndex()!.count * 2);
  });

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
