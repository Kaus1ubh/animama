import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "../Avatar";
import { collectAvatarLiveDiagnostics } from "../diagnostics/avatarDiagnostics";
import {
  loadWholeBodyAvatar,
  WHOLE_BODY_EYES,
  WHOLE_BODY_HEAD,
  WHOLE_BODY_UV,
} from "../testing/wholeBodyVrm";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";
import { AvatarVFXController } from "./AvatarVFXController";
import type { RuntimePrimitiveBindingEntry } from "./avatarPrimitiveUtils";
import { parseAvatarEffectDefinition } from "./definition";
import { loadEffectImage } from "./effect-image";
import { AVATAR_FACE_PARTS_SCHEMA } from "./faceParts";
import { applyAvatarVFXEffectById } from "./runtime";
import type { AvatarFaceTextureAnchorSnapshot } from "./texture-anchor-types";
import type { AvatarVFXCatalogEntry } from "./types";
import { baseTextureOf } from "./textureUvMapping";

vi.mock("./effect-image", () => ({ loadEffectImage: vi.fn() }));

/**
 * A face inside a whole-body primitive: a low-poly Avatar whose body, neck
 * and head are one primitive on one material and texture, its face painted
 * on (`testing/wholeBodyVrm.ts`). Its face is the head region facing forward;
 * face effects stay on it and body effects work as on any Avatar.
 */

const TEXTURE_SIZE = 512;

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

/** Every clip path any canvas context clipped with, in order. */
const clips: number[][][] = [];

/** A canvas whose 2D context accepts every call and records its clips. */
class RecordingCanvas {
  width = TEXTURE_SIZE;
  height = TEXTURE_SIZE;
  getContext() {
    const state: Record<string | symbol, unknown> = {
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      fillStyle: "",
      clip: (path: RecordingPath) => clips.push(path.triangles),
      getImageData: (
        _x: number,
        _y: number,
        width: number,
        height: number,
      ) => ({
        data: new Uint8ClampedArray(width * height * 4).fill(200),
      }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
    };
    return new Proxy(state, {
      get: (target, key) => (key in target ? target[key] : () => {}),
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    });
  }
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  clips.length = 0;
  vi.stubGlobal("HTMLCanvasElement", RecordingCanvas);
  vi.stubGlobal("Path2D", RecordingPath);
  vi.stubGlobal("document", { createElement: () => new RecordingCanvas() });
  vi.mocked(loadEffectImage).mockImplementation(
    async () => new RecordingCanvas() as unknown as HTMLCanvasElement,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The primitive holding the whole body (the first mesh's only one). */
function bodyEntry(avatar: Avatar): RuntimePrimitiveBindingEntry {
  const entries = buildRuntimePrimitiveBindings(avatar).entries.filter(
    (entry) => entry.bindingKey.split(":")[1] === "0",
  );
  expect(entries).toHaveLength(1);
  return entries[0]!;
}

/** Whether a triangle is drawn: hidden ones have all corners on one vertex. */
function drawn(entry: RuntimePrimitiveBindingEntry, triangle: number): boolean {
  const index = entry.object.geometry.getIndex()!;
  const at = triangle * 3;
  return !(
    index.getX(at) === index.getX(at + 1) &&
    index.getX(at) === index.getX(at + 2)
  );
}

type Part = keyof typeof WHOLE_BODY_UV;

/** The part of the fixture a texture point lies on. */
function partAt(u: number, v: number): Part | null {
  const found = (
    Object.entries(WHOLE_BODY_UV) as [Part, (typeof WHOLE_BODY_UV)[Part]][]
  ).find(
    ([, rect]) => u >= rect.u0 && u <= rect.u1 && v >= rect.v0 && v <= rect.v1,
  );
  return found?.[0] ?? null;
}

/** Each triangle's UV centroid and the part it belongs to. */
function triangleCentroids(
  entry: RuntimePrimitiveBindingEntry,
): { triangle: number; u: number; v: number; part: Part }[] {
  const geometry = entry.object.geometry;
  const index = geometry.getIndex()!;
  const uv = geometry.getAttribute("uv");
  const centroids = [];
  for (let triangle = 0; triangle < index.count / 3; triangle += 1) {
    let u = 0;
    let v = 0;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = index.getX(triangle * 3 + corner);
      u += uv.getX(vertex) / 3;
      v += uv.getY(vertex) / 3;
    }
    const part = partAt(u, v);
    if (!part) throw new Error(`Triangle ${triangle} is on no part`);
    centroids.push({ triangle, u, v, part });
  }
  return centroids;
}

/** How many of the listed triangles each part holds. */
function countParts(
  entry: RuntimePrimitiveBindingEntry,
  triangles: Iterable<number>,
): Partial<Record<Part, number>> {
  const parts = triangleCentroids(entry);
  const counts: Partial<Record<Part, number>> = {};
  for (const triangle of triangles) {
    const part = parts[triangle]!.part;
    counts[part] = (counts[part] ?? 0) + 1;
  }
  return counts;
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

const effect = (id: string, region: string, attachment: object) =>
  parseAvatarEffectDefinition(
    {
      schema: "animama/avatar-effect/2",
      region,
      attachment,
      art: { image: `${id}.png` },
    },
    { id, label: id, description: "", assetPath: `blob:${id}` },
  );

/** Red Face's attachment: whole-face art painted on the face skin. */
const RED_FACE = effect("red-face", "full_face", {
  kind: "face_surface",
  area: "full",
  part: "face_skin",
});
const BLUSH = effect("blush", "blush", {
  kind: "face_surface",
  area: "blush",
  layout: "single",
  mirror: true,
  part: "face_skin",
  side: "right",
});
const HEART_EYES = effect("heart-eyes", "eyes", {
  kind: "face_landmark",
  landmark: "eyes",
  mirror: true,
  side: "right",
});
const CHEST_HEART = effect("chest-heart", "body", {
  kind: "body",
  bone: "chest",
  size: 0.2,
});
/** Red Face that also hides the face skin it is painted on. */
const RED_FACE_HIDING_FACE = parseAvatarEffectDefinition(
  {
    schema: "animama/avatar-effect/2",
    region: "full_face",
    attachment: { kind: "face_surface", area: "full", part: "face_skin" },
    faceOptions: { hideParts: ["face_skin"] },
    art: { image: "red-face.png" },
  },
  {
    id: "red-face-hiding-face",
    label: "red-face-hiding-face",
    description: "",
    assetPath: "blob:red-face-hiding-face",
  },
);
/** Eye art that also hides the face skin (the creator's Hide face skin). */
const HEART_EYES_HIDING_FACE = parseAvatarEffectDefinition(
  {
    schema: "animama/avatar-effect/2",
    region: "eyes",
    attachment: {
      kind: "face_landmark",
      landmark: "eyes",
      mirror: true,
      side: "right",
    },
    faceOptions: { hideParts: ["face_skin"] },
    art: { image: "heart-eyes.png" },
  },
  {
    id: "heart-eyes-hiding-face",
    label: "heart-eyes-hiding-face",
    description: "",
    assetPath: "blob:heart-eyes-hiding-face",
  },
);

/** Apply `effects` through the runtime path, with a drawable face texture. */
async function applyAll(
  avatar: Avatar,
  effects: ReturnType<typeof effect>[],
): Promise<{ controller: AvatarVFXController; applied: boolean[] }> {
  const texture = baseTextureOf(bodyEntry(avatar).object)!;
  texture.image = new RecordingCanvas();
  const controller = new AvatarVFXController(avatar);
  avatar.vfxController = controller;
  const applied: boolean[] = [];
  for (const entry of effects) {
    applied.push(
      await applyAvatarVFXEffectById({
        avatar,
        effectId: entry.id,
        effectEntry: entry,
      }),
    );
  }
  return { controller, applied };
}

/** Whether a texture anchor lies on the face's own UV island. */
function onFace(anchor: AvatarFaceTextureAnchorSnapshot | null): boolean {
  return anchor !== null && partAt(anchor.uv.u, anchor.uv.v) === "face";
}

describe.each([1, 0] as const)(
  "a face inside a whole-body VRM %s primitive",
  (vrm) => {
    // A VRM 0 file faces -z: its face, and its left eye, have z and x negated.
    const sign = vrm === 0 ? -1 : 1;

    it("takes the head region facing forward as the face skin", async () => {
      const avatar = await loadWholeBodyAvatar({ vrm });
      const body = bodyEntry(avatar);
      const map = avatar.facePartMap!;

      expect(map.parts.face_skin).toMatchObject({
        bindings: [body.bindingKey],
        source: "signals",
      });
      const regions = map.parts.face_skin.regions ?? [];
      expect(regions.map((region) => region.bindingKey)).toEqual([
        body.bindingKey,
      ]);
      // The face (10 × 10 quads) and the eye strokes on it, skinned to the
      // head and facing forward; not the back or sides of the head, the neck,
      // the torso, or the fringe in front of the face.
      expect(countParts(body, regions[0]!.triangles)).toEqual({
        face: 200,
        eyeStrokes: 4,
      });
      expect(map.issues).toEqual([]);

      const diagnostics = collectAvatarLiveDiagnostics(avatar);
      expect(
        diagnostics.face.parts.find((part) => part.role === "face_skin"),
      ).toMatchObject({
        source: "signals",
        headRegion: true,
        bindingCount: 0,
        regionCount: 1,
      });
    });

    it("measures the face and finds its eyes, mouth and cheeks on it", async () => {
      const avatar = await loadWholeBodyAvatar({ vrm });
      const landmarks = avatar.getFaceLandmarksSnapshot()!;
      expect(landmarks.status).toBe("ready");
      // Face bounds come from the face, in head space: not the back of the
      // head, the neck, the body or the fringe sticking out in front.
      const headY = WHOLE_BODY_HEAD.center[1] - 1.5;
      const [, halfHeight, halfDepth] = WHOLE_BODY_HEAD.half;
      const bounds = landmarks.faceBoundsLocal!;
      expect(bounds.min.y).toBeCloseTo(headY - halfHeight, 3);
      expect(bounds.max.y).toBeCloseTo(headY + halfHeight, 3);
      const front = sign > 0 ? bounds.min.z : -bounds.max.z;
      const frontmost = sign > 0 ? bounds.max.z : -bounds.min.z;
      expect(front).toBeCloseTo(halfDepth, 3);
      expect(frontmost).toBeCloseTo(halfDepth, 2);
      expect(bounds.max.x).toBeCloseTo(WHOLE_BODY_HEAD.half[0], 3);

      // Painted eyes, found where blinking lowers the face.
      expect(avatar.facePartMap!.parts.eye_left).toMatchObject({
        source: "estimated",
        estimate: "blink",
      });
      for (const [side, [x, y]] of [
        ["left", WHOLE_BODY_EYES[0]],
        ["right", WHOLE_BODY_EYES[1]],
      ] as const) {
        const eye = landmarks.eyes[side]!;
        expect(eye.centerLocal.x).toBeCloseTo(x * sign, 2);
        expect(eye.centerLocal.y).toBeCloseTo(y - 1.5, 2);
        // On the face, not in front of it at the fringe.
        expect(eye.projectedFrontLocal.z).toBeCloseTo(halfDepth * sign, 2);
      }

      const anchors = avatar.getFaceTextureAnchorsSnapshot()!;
      expect(anchors.status).toBe("ready");
      for (const anchor of [
        anchors.anchors.blush.left,
        anchors.anchors.blush.right,
        anchors.anchors.undereye.left,
        anchors.anchors.undereye.right,
        anchors.anchors.mouth.center,
      ]) {
        expect(onFace(anchor), JSON.stringify(anchor)).toBe(true);
      }
    });

    it("paints whole-face art only on the face's texels", async () => {
      const avatar = await loadWholeBodyAvatar({ vrm });
      const body = bodyEntry(avatar);
      const { applied } = await applyAll(avatar, [RED_FACE]);
      expect(applied).toEqual([true]);

      // The only colour slot (the base colour map) is clipped to the face.
      expect(clips).toHaveLength(1);
      const clip = clips[0]!;
      for (const { u, v, part } of triangleCentroids(body)) {
        expect(
          covers(clip, u * TEXTURE_SIZE, v * TEXTURE_SIZE),
          `${part} at ${u.toFixed(3)}, ${v.toFixed(3)}`,
        ).toBe(part === "face");
      }
    });
  },
);

describe("a face inside a whole-body primitive", () => {
  it("keeps decals inside the face, clipped to it", async () => {
    const avatar = await loadWholeBodyAvatar();
    const { controller, applied } = await applyAll(avatar, [BLUSH]);
    expect(applied).toEqual([true]);
    expect(controller.getSnapshot().warnings).toEqual([]);

    // Each cheek's decal is drawn through the face's clip, so art reaching
    // past the face's island cannot paint the body sharing the texture.
    expect(clips.length).toBeGreaterThan(0);
    for (const clip of clips) {
      expect(covers(clip, 0.25 * TEXTURE_SIZE, 0.25 * TEXTURE_SIZE)).toBe(true);
      expect(covers(clip, 0.6 * TEXTURE_SIZE, 0.1 * TEXTURE_SIZE)).toBe(false);
    }
  });

  it("puts eye art on the painted eyes and body art on the body", async () => {
    const avatar = await loadWholeBodyAvatar();
    const { controller, applied } = await applyAll(avatar, [
      HEART_EYES,
      CHEST_HEART,
    ]);
    expect(applied).toEqual([true, true]);
    expect(controller.getSnapshot().warnings).toEqual([]);

    // The skin painted over the eyes under eye art keeps to the face too.
    expect(clips.length).toBeGreaterThan(0);
    for (const clip of clips) {
      expect(covers(clip, 0.25 * TEXTURE_SIZE, 0.25 * TEXTURE_SIZE)).toBe(true);
      expect(covers(clip, 0.6 * TEXTURE_SIZE, 0.1 * TEXTURE_SIZE)).toBe(false);
    }
  });

  it("warns when no forward-facing part is skinned to the head", async () => {
    const avatar = await loadWholeBodyAvatar({ headBone: "neck" });
    const map = avatar.facePartMap!;
    expect(map.parts.face_skin.source).toBe("missing");
    expect(map.issues).toContainEqual({
      code: "face_parts_whole_body_head_missing",
    });

    const { controller, applied } = await applyAll(avatar, [
      RED_FACE,
      CHEST_HEART,
    ]);
    expect(applied).toEqual([false, true]);
    expect(controller.getSnapshot().warnings).toEqual([
      'Skipped "red-face": this avatar has no detected face skin.',
    ]);
  });

  it("keeps face skin corrected to the body primitive to its head", async () => {
    const avatar = await loadWholeBodyAvatar();
    const body = bodyEntry(avatar);
    const detected = avatar.facePartMap!.parts.face_skin.regions;
    await avatar.setFacePartCorrections({
      schema: AVATAR_FACE_PARTS_SCHEMA,
      vrm_sha256: "d".repeat(64),
      parts: {
        face_skin: [body.bindingKey],
        eye_left: [],
        eye_right: [],
      },
    });

    expect(avatar.facePartMap!.parts.face_skin).toMatchObject({
      source: "corrected",
      bindings: [body.bindingKey],
      regions: detected,
    });
  });

  it("keeps a corrected body primitive whole when it has no head region", async () => {
    const avatar = await loadWholeBodyAvatar({ headBone: "neck" });
    const body = bodyEntry(avatar);
    await avatar.setFacePartCorrections({
      schema: AVATAR_FACE_PARTS_SCHEMA,
      vrm_sha256: "d".repeat(64),
      parts: { face_skin: [body.bindingKey], eye_left: [], eye_right: [] },
    });

    const face = avatar.facePartMap!.parts.face_skin;
    expect(face).toMatchObject({
      source: "corrected",
      bindings: [body.bindingKey],
    });
    expect(face.regions).toBeUndefined();
  });

  it("does not take a body primitive without a head region as the face by its name", async () => {
    const avatar = await loadWholeBodyAvatar({
      headBone: "neck",
      materialName: "Face",
    });

    const map = avatar.facePartMap!;
    expect(map.parts.face_skin).toMatchObject({
      source: "missing",
      bindings: [],
    });
    expect(map.issues).toContainEqual({
      code: "face_parts_whole_body_head_missing",
    });
  });

  it("finds the face island from the eye bones when blinking moves nothing", async () => {
    const avatar = await loadWholeBodyAvatar({ eyes: "bones" });
    const body = bodyEntry(avatar);
    const map = avatar.facePartMap!;

    // The fringe in front of the face is its own island and stays out.
    expect(
      countParts(body, map.parts.face_skin.regions![0]!.triangles),
    ).toEqual({ face: 200, eyeStrokes: 4 });
    expect(map.parts.eye_left).toMatchObject({
      source: "estimated",
      estimate: "eye_bone",
    });
  });

  it("hides only the face region when eye art hides the face skin", async () => {
    const avatar = await loadWholeBodyAvatar({ eyes: "bones", irises: true });
    const body = bodyEntry(avatar);
    const map = avatar.facePartMap!;
    expect(map.parts.eye_left.bindings).not.toEqual([]);
    const region = map.parts.face_skin.regions![0]!.triangles;
    const torso = triangleCentroids(body).find(
      ({ part }) => part === "torsoFront",
    )!.triangle;

    const { controller, applied } = await applyAll(avatar, [
      HEART_EYES_HIDING_FACE,
    ]);
    expect(applied).toEqual([true]);
    expect(controller.getSnapshot().warnings).toEqual([]);
    // The eye art sits on the irises; the body stays, only its face hidden.
    expect(body.object.visible).toBe(true);
    expect(region.every((triangle) => !drawn(body, triangle))).toBe(true);
    expect(drawn(body, torso)).toBe(true);

    controller.clearAllEffects();
    expect(region.every((triangle) => drawn(body, triangle))).toBe(true);
  });

  it.each([
    ["eye art on the face", {}],
    ["eye art on iris primitives", { eyes: "bones", irises: true }],
  ] as const)(
    "paints the whole face again after %s that hid the face skin",
    async (_, options) => {
      const avatar = await loadWholeBodyAvatar(options);
      const body = bodyEntry(avatar);
      const { controller, applied } = await applyAll(avatar, [
        HEART_EYES_HIDING_FACE,
      ]);
      expect(applied).toEqual([true]);
      // The skin painted over the eyes built the face's clip during the eye
      // art, while the face was hidden if the art was on the irises.
      expect(clips.length).toBeGreaterThan(0);
      controller.clearAllEffects();
      clips.length = 0;

      await controller.applyEffect({
        bindingKey: body.bindingKey,
        effectId: RED_FACE.id,
        effectEntry: RED_FACE as AvatarVFXCatalogEntry,
      });
      expect(controller.getSnapshot().warnings).toEqual([]);
      expect(clips).toHaveLength(1);
      for (const { u, v, part } of triangleCentroids(body)) {
        expect(
          covers(clips[0]!, u * TEXTURE_SIZE, v * TEXTURE_SIZE),
          `${part} at ${u.toFixed(3)}, ${v.toFixed(3)}`,
        ).toBe(part === "face");
      }
    },
  );

  it("keeps the face visible under art on it that hides the face skin", async () => {
    for (const art of [RED_FACE_HIDING_FACE, HEART_EYES_HIDING_FACE]) {
      const avatar = await loadWholeBodyAvatar();
      const body = bodyEntry(avatar);
      const face = triangleCentroids(body)
        .filter(({ part }) => part === "face")
        .map(({ triangle }) => triangle);
      const { controller, applied } = await applyAll(avatar, [art]);
      expect(applied).toEqual([true]);
      expect(controller.getSnapshot().warnings).toEqual([]);
      // Both are held by the face skin binding: its face stays drawn (eye
      // art still hides the painted eye strokes, as eye lines).
      expect(
        face.every((triangle) => drawn(body, triangle)),
        art.id,
      ).toBe(true);
    }
  });

  it("does not paint whole-face art when no face triangle is left to clip to", async () => {
    const avatar = await loadWholeBodyAvatar();
    const body = bodyEntry(avatar);
    // Every face triangle collapsed onto one corner (as a broken file might
    // hold them): the clip has nothing to draw through.
    const index = body.object.geometry.getIndex()!;
    for (const triangle of avatar.facePartMap!.parts.face_skin.regions![0]!
      .triangles) {
      const first = index.getX(triangle * 3);
      index.setX(triangle * 3 + 1, first);
      index.setX(triangle * 3 + 2, first);
    }

    const { controller } = await applyAll(avatar, [RED_FACE]);
    const snapshot = controller.getSnapshot();
    expect(snapshot.activeEffects).toEqual([]);
    expect(snapshot.warnings).toEqual([
      expect.stringContaining("Whole-face art is not drawn"),
    ]);
  });

  it("does not take a body primitive as the face by its name when its head never moves", async () => {
    const avatar = await loadWholeBodyAvatar({
      still: true,
      materialName: "Face",
    });

    // Detection warns that blinking and the mouth move no head region, and
    // the material's name does not make the body the face after all.
    const map = avatar.facePartMap!;
    expect(map.parts.face_skin).toMatchObject({
      source: "missing",
      bindings: [],
    });
    expect(map.issues).toContainEqual({
      code: "face_parts_whole_body_head_missing",
    });
  });

  it("does not paint whole-face art when the face's outline cannot be read", async () => {
    const avatar = await loadWholeBodyAvatar();
    // UVs the clip cannot read (interleaved), after landmarks and anchors.
    const geometry = bodyEntry(avatar).object.geometry;
    const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
    geometry.setAttribute(
      "uv",
      new THREE.InterleavedBufferAttribute(
        new THREE.InterleavedBuffer(uv.array as Float32Array, 2),
        2,
        0,
      ),
    );

    // The request goes through, but the controller places nothing and
    // warns, as for any effect it cannot place.
    const { controller } = await applyAll(avatar, [RED_FACE]);
    const snapshot = controller.getSnapshot();
    expect(snapshot.activeEffects).toEqual([]);
    expect(snapshot.warnings).toEqual([
      expect.stringContaining("Whole-face art is not drawn"),
    ]);
    expect(snapshot.issues).toContainEqual({
      code: "effect_placement_failed",
      params: { effectId: "red-face" },
    });
    expect(clips).toEqual([]);
  });
});
