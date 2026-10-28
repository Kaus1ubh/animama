import { VRMExpression } from "@pixiv/three-vrm";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "../Avatar";
import { collectAvatarLiveDiagnostics } from "../diagnostics/avatarDiagnostics";
import { appendTriangle } from "../testing/appendTriangle";
import { blinkTargets } from "../testing/blinkStrand";
import {
  VRM0_FIXTURE_ID,
  type TestAvatarId,
} from "../motion-authoring/testing/includedAvatars";
import { loadedTestAvatar } from "../testing/loadedTestAvatar";
import { removeEyeBones } from "../testing/removeEyeBones";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";
import { AvatarVFXController } from "./AvatarVFXController";
import type { RuntimePrimitiveBindingEntry } from "./avatarPrimitiveUtils";
import { parseAvatarEffectDefinition } from "./definition";
import { loadEffectImage } from "./effect-image";
import type { AvatarFaceEyeLandmarkSnapshot } from "./landmark-types";
import { applyAvatarVFXEffectById } from "./runtime";
import { baseTextureOf } from "./textureUvMapping";

vi.mock("./effect-image", () => ({ loadEffectImage: vi.fn() }));

/**
 * Eyes without geometry of their own, made from Annie with her eye meshes
 * removed: eyes modelled inside the face primitive (found where blink moves
 * the face), painted eyes with eye bones but no blink, painted eyes with only
 * a look-at origin, and painted eyes with none of these.
 */

/** A canvas whose 2D context accepts every call, enough for composites. */
class StubCanvas {
  width = 256;
  height = 256;
  getContext() {
    const state: Record<string | symbol, unknown> = {
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      fillStyle: "",
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
  vi.stubGlobal("HTMLCanvasElement", StubCanvas);
  vi.stubGlobal("document", { createElement: () => new StubCanvas() });
  vi.mocked(loadEffectImage).mockImplementation(
    async () => new StubCanvas() as unknown as HTMLCanvasElement,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function headOf(avatar: Avatar): THREE.Object3D {
  return avatar.vrm!.humanoid.getNormalizedBoneNode("head")!;
}

function entryOf(avatar: Avatar, key: string): RuntimePrimitiveBindingEntry {
  return buildRuntimePrimitiveBindings(avatar).entries.find(
    (entry) => entry.bindingKey === key,
  )!;
}

const vector = (value: THREE.Vector3Like) => new THREE.Vector3().copy(value);

/** A blink that moves nothing, as a model without any blink shape. */
function removeBlink(avatar: Avatar): void {
  const manager = avatar.vrm!.expressionManager!;
  manager.unregisterExpression(manager.getExpression("blink")!);
  manager.registerExpression(new VRMExpression("blink"));
}

/**
 * Annie (or another VRoid test Avatar) with her eye meshes (irises,
 * highlights, whites) taken out, so her eyes have no geometry of their own;
 * returns her original eye landmarks.
 */
async function annieWithoutEyeMeshes(
  id: TestAvatarId = "AvatarSample_A_1_New",
): Promise<{
  avatar: Avatar;
  eyes: {
    left: AvatarFaceEyeLandmarkSnapshot;
    right: AvatarFaceEyeLandmarkSnapshot;
  };
}> {
  const avatar = await loadedTestAvatar(id);
  const { left, right } = avatar.getFaceLandmarksSnapshot()!.eyes;
  const map = avatar.facePartMap!;
  for (const key of new Set([
    ...map.parts.eye_left.bindings,
    ...map.parts.eye_right.bindings,
    ...map.parts.eye_highlight.bindings,
    ...map.eyeWhite,
  ])) {
    entryOf(avatar, key).object.removeFromParent();
  }
  // Annie's eye whites carry no eye-bone weight; find them by name.
  for (const entry of buildRuntimePrimitiveBindings(avatar).entries) {
    if (entry.materialName?.includes("EyeWhite")) {
      entry.object.removeFromParent();
    }
  }
  return { avatar, eyes: { left: left!, right: right! } };
}

/**
 * Move the normalized eye bones to `place(eye)` (the eye's original centre in
 * head space), as another rig would put them.
 */
function moveEyeBones(
  avatar: Avatar,
  eyes: Record<"left" | "right", AvatarFaceEyeLandmarkSnapshot>,
  place: (centre: THREE.Vector3) => THREE.Vector3,
): void {
  const head = headOf(avatar);
  for (const side of ["left", "right"] as const) {
    const node = avatar.vrm!.humanoid.getNormalizedBoneNode(
      side === "left" ? "leftEye" : "rightEye",
    )!;
    const target = head.localToWorld(place(vector(eyes[side].centerLocal)));
    node.position.copy(node.parent!.worldToLocal(target));
    node.updateMatrixWorld(true);
  }
}

/** Behind where the iris was, at the eyeball's centre, as VRChat rigs place it. */
const behindIris = (frontSign: 1 | -1) => (centre: THREE.Vector3) =>
  centre.setZ(centre.z - 0.03 * frontSign);

/** Stop blink moving the face skin on the head's right half (VRM 1). */
function blinkLeftHalfOnly(avatar: Avatar, face: RuntimePrimitiveBindingEntry) {
  const mesh = face.object;
  const position = mesh.geometry.getAttribute("position");
  const anchor = headOf(avatar);
  mesh.updateWorldMatrix(true, false);
  anchor.updateWorldMatrix(true, false);
  const point = new THREE.Vector3();
  for (const index of blinkTargets(avatar, mesh)) {
    const target = mesh.geometry.morphAttributes.position![index]!;
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      point.fromBufferAttribute(position, vertex);
      anchor.worldToLocal(mesh.localToWorld(point));
      if (point.x < 0) target.setXYZ(vertex, 0, 0, 0);
    }
  }
}

const effect = (id: string, attachment: object) =>
  parseAvatarEffectDefinition(
    {
      schema: "animama/avatar-effect/2",
      region: id === "heart-eyes" ? "eyes" : id === "blush" ? "blush" : "emote",
      attachment,
      art: { image: `${id}.png` },
    },
    { id, label: id, description: "", assetPath: `blob:${id}` },
  );

/** Heart-eyes-like art over both eyes, a cheek blush and a forehead mark. */
const EFFECTS = [
  effect("heart-eyes", {
    kind: "face_landmark",
    landmark: "eyes",
    mirror: true,
    side: "right",
  }),
  effect("blush", {
    kind: "face_surface",
    area: "blush",
    layout: "single",
    mirror: true,
    part: "face_skin",
    side: "right",
  }),
  effect("under-eye", {
    kind: "face_surface",
    area: "undereye",
    layout: "single",
    mirror: true,
    part: "face_skin",
    side: "right",
  }),
  effect("forehead", {
    kind: "face_landmark",
    landmark: "forehead",
    position: "middle",
  }),
];

/** Apply `effects` through the runtime path; returns the controller. */
async function applyAll(
  avatar: Avatar,
  effects = EFFECTS,
): Promise<{ controller: AvatarVFXController; applied: boolean[] }> {
  const face = entryOf(
    avatar,
    avatar.facePartMap!.parts.face_skin.bindings[0]!,
  );
  baseTextureOf(face.object)!.image = new StubCanvas();
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

/** The eye planes an effect hung from the head. */
function eyePlanes(avatar: Avatar, id: string): THREE.Mesh[] {
  const planes: THREE.Mesh[] = [];
  headOf(avatar).traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.name.startsWith(`${id}:`) &&
      !object.name.endsWith(":backdrop")
    ) {
      planes.push(object);
    }
  });
  return planes;
}

describe("eyes modelled inside the face primitive", () => {
  /**
   * Annie without eye bones or eye meshes, with an iris island inside her
   * face primitive at each eye: blink closes her lids over it.
   */
  async function annieWithMergedEyes() {
    const { avatar, eyes } = await annieWithoutEyeMeshes();
    removeEyeBones(avatar);
    const face = entryOf(
      avatar,
      avatar.facePartMap!.parts.face_skin.bindings[0]!,
    );
    for (const eye of [eyes.left, eyes.right]) {
      const { x, y, z } = eye.centerLocal;
      appendTriangle({
        avatar,
        binding: face,
        anchor: headOf(avatar),
        corners: [
          new THREE.Vector3(x - 0.01, y - 0.01, z),
          new THREE.Vector3(x + 0.01, y - 0.01, z),
          new THREE.Vector3(x, y + 0.012, z),
        ],
        uv: [
          [0.05, 0.05],
          [0.07, 0.05],
          [0.06, 0.07],
        ],
      });
    }
    await avatar.setFacePartCorrections(null);
    return { avatar, eyes, face };
  }

  it("places each eye where blink moves the face, sized like an iris", async () => {
    const { avatar, eyes, face } = await annieWithMergedEyes();

    const parts = avatar.facePartMap!.parts;
    for (const role of ["eye_left", "eye_right"] as const) {
      expect(parts[role]).toMatchObject({
        source: "estimated",
        estimate: "blink",
        bindings: [],
      });
    }
    expect(
      collectAvatarLiveDiagnostics(avatar).face.parts.find(
        (part) => part.role === "eye_left",
      ),
    ).toMatchObject({ source: "estimated", estimate: "blink" });

    const landmarks = avatar.getFaceLandmarksSnapshot()!;
    expect(landmarks.issues).toEqual([]);
    for (const side of ["left", "right"] as const) {
      const eye = landmarks.eyes[side]!;
      const original = eyes[side];
      expect(eye).toMatchObject({
        estimate: "blink",
        bindingKey: face.bindingKey,
      });
      // Within a centimetre of where her iris was, on the same side.
      expect(
        vector(eye.centerLocal).distanceTo(vector(original.centerLocal)),
      ).toBeLessThan(0.01);
      expect(Math.sign(eye.centerLocal.x)).toBe(
        Math.sign(original.centerLocal.x),
      );
      for (const axis of ["x", "y"] as const) {
        expect(eye.boundsLocal.size[axis]).toBeGreaterThan(
          original.boundsLocal.size[axis] * 0.75,
        );
        expect(eye.boundsLocal.size[axis]).toBeLessThan(
          original.boundsLocal.size[axis] * 1.25,
        );
      }
    }
  });

  it("leaves out a brow that blink lowers apart from the lid", async () => {
    const { avatar, eyes, face } = await annieWithMergedEyes();
    const lowered = avatar.vrm!.expressionManager!.getExpression("blink")!
      .binds as unknown as { primitives?: unknown[]; index?: number }[];
    const targets = lowered
      .filter((bind) => bind.primitives?.includes(face.object))
      .map((bind) => bind.index!);
    for (const eye of [eyes.left, eyes.right]) {
      const { x, y, z } = eye.centerLocal;
      // A brow strand well above the lid, lowered about as far as the lid.
      appendTriangle({
        avatar,
        binding: face,
        anchor: headOf(avatar),
        corners: [
          new THREE.Vector3(x - 0.012, y + 0.06, z + 0.004),
          new THREE.Vector3(x + 0.012, y + 0.06, z + 0.004),
          new THREE.Vector3(x, y + 0.064, z + 0.004),
        ],
        uv: [
          [0.1, 0.1],
          [0.12, 0.1],
          [0.11, 0.12],
        ],
        morph: { targets, offset: new THREE.Vector3(0, -0.013, 0) },
      });
    }
    await avatar.setFacePartCorrections(null);

    const landmarks = avatar.getFaceLandmarksSnapshot()!;
    for (const side of ["left", "right"] as const) {
      const eye = landmarks.eyes[side]!;
      const original = eyes[side];
      expect(
        vector(eye.centerLocal).distanceTo(vector(original.centerLocal)),
      ).toBeLessThan(0.01);
      expect(eye.boundsLocal.size.y).toBeLessThan(
        original.boundsLocal.size.y * 1.25,
      );
    }
  });

  it("takes the eye texture rect from the face UVs blink moves", async () => {
    const { avatar } = await annieWithMergedEyes();
    const landmarks = avatar.getFaceLandmarksSnapshot()!;
    const anchors = avatar.getFaceTextureAnchorsSnapshot()!;
    for (const side of ["left", "right"] as const) {
      const rect = landmarks.eyes[side]!.textureRect!;
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(1);
      // The eye's own point on the face texture lies inside it.
      const { u } = anchors.flatten.eyes[side]!.uv;
      expect(u).toBeGreaterThan(rect.x);
      expect(u).toBeLessThan(rect.x + rect.width);
    }
    // The two eyes sit on opposite halves of the face texture.
    const left = landmarks.eyes.left!.textureRect!;
    const right = landmarks.eyes.right!.textureRect!;
    expect(Math.min(left.x + left.width, right.x + right.width)).toBeLessThan(
      Math.max(left.x, right.x),
    );
  });

  it("resolves blush, under-eye and mouth anchors and plays face effects", async () => {
    const { avatar } = await annieWithMergedEyes();
    const anchors = avatar.getFaceTextureAnchorsSnapshot()!;
    expect(anchors.status).toBe("ready");
    expect(anchors.anchors.blush.left).not.toBeNull();
    expect(anchors.anchors.blush.right).not.toBeNull();
    expect(anchors.anchors.undereye.left).not.toBeNull();
    expect(anchors.anchors.undereye.right).not.toBeNull();
    expect(anchors.anchors.mouth.center).not.toBeNull();

    const { controller, applied } = await applyAll(avatar);
    expect(controller.getSnapshot().warnings).toEqual([]);
    expect(applied).toEqual([true, true, true, true]);
    expect(
      controller
        .getSnapshot()
        .activeEffects.map((active) => active.appliedEffectId)
        .sort(),
    ).toEqual(["blush", "forehead", "heart-eyes", "under-eye"]);
    // One plane in front of each estimated eye, closing the eyes.
    const planes = eyePlanes(avatar, "heart-eyes");
    expect(planes).toHaveLength(2);
    const head = headOf(avatar);
    const landmarks = avatar.getFaceLandmarksSnapshot()!;
    const centres = planes.map((plane) =>
      head.worldToLocal(plane.getWorldPosition(new THREE.Vector3())),
    );
    for (const side of ["left", "right"] as const) {
      const eye = vector(landmarks.eyes[side]!.centerLocal);
      const nearest = Math.min(
        ...centres.map((centre) =>
          Math.hypot(centre.x - eye.x, centre.y - eye.y),
        ),
      );
      expect(nearest).toBeLessThan(0.002);
    }
    expect(controller.getSnapshot().flatten.activeEyes).toBe(true);
  });
});

describe("eyes found where a VRM 0 head blinks", () => {
  it("keeps each eye on its own side of the head", async () => {
    // A VRM 0 head faces -z, so the Avatar's left is -x.
    const { avatar, eyes } = await annieWithoutEyeMeshes(VRM0_FIXTURE_ID);
    removeEyeBones(avatar);
    await avatar.setFacePartCorrections(null);

    const landmarks = avatar.getFaceLandmarksSnapshot()!;
    expect(eyes.left.centerLocal.x).toBeLessThan(0);
    for (const side of ["left", "right"] as const) {
      expect(avatar.facePartMap!.parts[`eye_${side}`]).toMatchObject({
        source: "estimated",
        estimate: "blink",
      });
      expect(
        vector(landmarks.eyes[side]!.centerLocal).distanceTo(
          vector(eyes[side].centerLocal),
        ),
      ).toBeLessThan(0.012);
    }
    const { controller, applied } = await applyAll(avatar);
    expect(controller.getSnapshot().warnings).toEqual([]);
    expect(applied).toEqual([true, true, true, true]);
  });
});

describe("an eye without an iris mesh", () => {
  it("skips iris art, saying the eye has no iris mesh", async () => {
    const { avatar } = await annieWithoutEyeMeshes();
    removeEyeBones(avatar);
    await avatar.setFacePartCorrections(null);
    expect(avatar.facePartMap!.parts.eye_left.source).toBe("estimated");

    const irisArt = parseAvatarEffectDefinition(
      {
        schema: "animama/avatar-effect/2",
        region: "eyes",
        attachment: {
          kind: "face_surface",
          area: "eyes",
          layout: "single",
          part: "eye_iris",
        },
        art: { image: "iris-art.png" },
      },
      {
        id: "iris-art",
        label: "iris-art",
        description: "",
        assetPath: "blob:iris-art",
      },
    );
    const { controller, applied } = await applyAll(avatar, [irisArt]);
    expect(applied).toEqual([false]);
    expect(controller.getSnapshot().warnings).toEqual([
      'Skipped "iris-art": this avatar\'s left eye has no iris mesh.',
    ]);
    expect(controller.getSnapshot().issues).toEqual([
      {
        code: "effect_face_part_missing",
        params: { effectId: "iris-art", part: "eye_left" },
      },
    ]);
  });
});

describe("one eye blinking, the other only with its bone", () => {
  it("places the first from blink and the second from its bone", async () => {
    const { avatar, eyes } = await annieWithoutEyeMeshes();
    moveEyeBones(avatar, eyes, behindIris(1));
    blinkLeftHalfOnly(
      avatar,
      entryOf(avatar, avatar.facePartMap!.parts.face_skin.bindings[0]!),
    );
    await avatar.setFacePartCorrections(null);

    const parts = avatar.facePartMap!.parts;
    expect(parts.eye_left).toMatchObject({
      source: "estimated",
      estimate: "blink",
    });
    expect(parts.eye_right).toMatchObject({
      source: "estimated",
      estimate: "eye_bone",
    });
    const { left, right } = avatar.getFaceLandmarksSnapshot()!.eyes;
    expect(left!.estimate).toBe("blink");
    expect(right!.estimate).toBe("eye_bone");
    expect(right!.centerLocal.x).toBeCloseTo(eyes.right.centerLocal.x, 5);
  });
});

describe("painted eyes with eye bones and no blink", () => {
  /**
   * Annie without eye meshes or a blink, her eye bones moved behind where her
   * irises were (at the eyeball centres, as VRChat rigs place them).
   */
  async function annieWithPaintedEyes(
    id: TestAvatarId = "AvatarSample_A_1_New",
  ) {
    const { avatar, eyes } = await annieWithoutEyeMeshes(id);
    removeBlink(avatar);
    moveEyeBones(avatar, eyes, behindIris(id === VRM0_FIXTURE_ID ? -1 : 1));
    await avatar.setFacePartCorrections(null);
    return { avatar, eyes };
  }

  it("places each eye from its bone, on the face, sized from the face width", async () => {
    const { avatar, eyes } = await annieWithPaintedEyes();
    const parts = avatar.facePartMap!.parts;
    expect(parts.face_skin.bindings).toHaveLength(1);
    for (const role of ["eye_left", "eye_right"] as const) {
      expect(parts[role]).toMatchObject({
        source: "estimated",
        estimate: "eye_bone",
      });
    }
    const landmarks = avatar.getFaceLandmarksSnapshot()!;
    const faceWidth = landmarks.faceBoundsLocal!.size.x;
    for (const side of ["left", "right"] as const) {
      const eye = landmarks.eyes[side]!;
      const original = eyes[side].centerLocal;
      expect(eye.estimate).toBe("eye_bone");
      expect(eye.textureRect).toBeNull();
      expect(eye.centerLocal.x).toBeCloseTo(original.x, 5);
      expect(eye.centerLocal.y).toBeCloseTo(original.y, 5);
      // On the face skin in front of the bone, not inside the head.
      expect(eye.centerLocal.z).toBeGreaterThan(original.z - 0.005);
      expect(eye.centerLocal.z).toBeLessThan(landmarks.frontZLocal!);
      expect(eye.boundsLocal.size.x).toBeCloseTo(faceWidth * 0.14, 5);
    }
  });

  it("covers the painted eyes with eye art and its cleanup", async () => {
    const { avatar, eyes } = await annieWithPaintedEyes();
    const { controller, applied } = await applyAll(avatar);
    expect(controller.getSnapshot().warnings).toEqual([]);
    expect(applied).toEqual([true, true, true, true]);
    expect(eyePlanes(avatar, "heart-eyes")).toHaveLength(2);
    // With no blink to close them, cleanup paints over each painted eye: a
    // region holding the eye's centre, at least twice the iris it replaces.
    // (Annie's face keeps the holes her eye meshes filled, so the region is
    // projected onto a hole's rim.)
    const anchors = avatar.getFaceTextureAnchorsSnapshot()!;
    for (const side of ["left", "right"] as const) {
      const region = anchors.flatten.eyes[side]!;
      const centre = eyes[side].centerLocal;
      const size = region.referenceSizeLocal;
      expect(Math.abs(region.localPoint.x - centre.x)).toBeLessThan(
        size.width / 2,
      );
      expect(Math.abs(region.localPoint.y - centre.y)).toBeLessThan(
        size.height / 2,
      );
      expect(size.width).toBeGreaterThan(eyes[side].boundsLocal.size.x * 2);
    }
    expect(controller.getSnapshot().flatten.activeEyes).toBe(true);
  });
});

describe("painted eyes placed from their bones", () => {
  it("lands VRM 0 eyes on the front of a head facing -z", async () => {
    const { avatar, eyes } = await annieWithoutEyeMeshes(VRM0_FIXTURE_ID);
    removeBlink(avatar);
    moveEyeBones(avatar, eyes, behindIris(-1));
    await avatar.setFacePartCorrections(null);

    const landmarks = avatar.getFaceLandmarksSnapshot()!;
    for (const side of ["left", "right"] as const) {
      const eye = landmarks.eyes[side]!;
      const original = eyes[side].centerLocal;
      expect(eye.estimate).toBe("eye_bone");
      expect(eye.centerLocal.x).toBeCloseTo(original.x, 5);
      // In front of the bone: toward -z.
      expect(eye.centerLocal.z).toBeLessThan(original.z + 0.005);
      expect(eye.centerLocal.z).toBeGreaterThan(landmarks.frontZLocal!);
    }
  });

  it("never lands on the back of the head behind an eye hole", async () => {
    const { avatar, eyes } = await annieWithoutEyeMeshes();
    removeBlink(avatar);
    moveEyeBones(avatar, eyes, behindIris(1));
    // The back of the head, covering the left eye hole in the front view
    // and wound to face backward.
    const face = entryOf(
      avatar,
      avatar.facePartMap!.parts.face_skin.bindings[0]!,
    );
    const back = avatar.getFaceLandmarksSnapshot()!.faceBoundsLocal!.min.z;
    const { x, y } = eyes.left.centerLocal;
    appendTriangle({
      avatar,
      binding: face,
      anchor: headOf(avatar),
      corners: [
        new THREE.Vector3(x - 0.03, y - 0.03, back + 0.01),
        new THREE.Vector3(x, y + 0.03, back + 0.01),
        new THREE.Vector3(x + 0.03, y - 0.03, back + 0.01),
      ],
      uv: [
        [0.1, 0.1],
        [0.11, 0.12],
        [0.12, 0.1],
      ],
    });
    await avatar.setFacePartCorrections(null);

    const eye = avatar.getFaceLandmarksSnapshot()!.eyes.left!;
    expect(eye.estimate).toBe("eye_bone");
    expect(eye.centerLocal.z).toBeGreaterThan(eyes.left.centerLocal.z - 0.005);
  });
});

describe("painted eyes without a blink or eye bones that mark them", () => {
  it("leaves the eyes missing and names them when an eye effect is skipped", async () => {
    const { avatar } = await annieWithoutEyeMeshes();
    removeBlink(avatar);
    removeEyeBones(avatar);
    // A look-at origin (VRoid's default here) does not place eyes.
    expect(avatar.vrm!.lookAt!.offsetFromHeadBone.length()).toBeGreaterThan(0);
    await avatar.setFacePartCorrections(null);

    expect(avatar.facePartMap!.parts.eye_left.source).toBe("missing");
    expect(avatar.facePartMap!.parts.eye_right.source).toBe("missing");
    expect(avatar.facePartMap!.eyeEstimates).toBeUndefined();
    expect(avatar.getFaceLandmarksSnapshot()!.issues).toContainEqual({
      code: "landmarks_eyes_missing",
    });
    const { controller, applied } = await applyAll(avatar, EFFECTS.slice(0, 1));
    expect(applied).toEqual([false]);
    expect(controller.getSnapshot().warnings).toEqual([
      'Skipped "heart-eyes": this avatar has no detected left eye.',
    ]);
  });

  it("does not take eye bones at the head's centre for eyes", async () => {
    const { avatar, eyes } = await annieWithoutEyeMeshes();
    removeBlink(avatar);
    moveEyeBones(avatar, eyes, (centre) => centre.setX(0));
    await avatar.setFacePartCorrections(null);

    expect(avatar.facePartMap!.parts.eye_left.source).toBe("missing");
    expect(avatar.facePartMap!.parts.eye_right.source).toBe("missing");
    const { controller, applied } = await applyAll(avatar, EFFECTS.slice(0, 1));
    expect(applied).toEqual([false]);
    expect(controller.getSnapshot().warnings).toEqual([
      'Skipped "heart-eyes": this avatar has no detected left eye.',
    ]);
  });

  it("keeps an eye a correction marks absent absent", async () => {
    const { avatar } = await annieWithoutEyeMeshes();
    const sha = "c".repeat(64);
    await avatar.setFacePartCorrections({
      schema: "animama/avatar-face-parts/1",
      vrm_sha256: sha,
      parts: {
        face_skin: avatar.facePartMap!.parts.face_skin.bindings,
        eye_left: [],
        eye_right: [],
      },
    });
    expect(avatar.facePartMap!.parts.eye_left).toMatchObject({
      source: "corrected",
      bindings: [],
    });
    expect(avatar.getFaceLandmarksSnapshot()!.eyes.left).toBeNull();
  });
});
