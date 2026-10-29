import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "../Avatar";
import {
  measureAvatarProportions,
  measureHeadBounds,
} from "../avatarProportions";
import { StubCanvas } from "../testing/stubCanvas";
import { loadWholeBodyAvatar } from "../testing/wholeBodyVrm";
import {
  HEAD_STICKER_REFERENCE_HEIGHT,
  measureAvatarHeight,
} from "./AvatarAttachmentEffects";
import { AvatarVFXController } from "./AvatarVFXController";
import { parseAvatarEffectDefinition } from "./definition";
import { loadEffectImage } from "./effect-image";
import { applyAvatarVFXEffectById } from "./runtime";

vi.mock("./effect-image", () => ({ loadEffectImage: vi.fn() }));

/*
 * Head art, Reaction sparkles and eye overlays on a big-headed Avatar: the
 * synthetic whole-body Avatar (`testing/wholeBodyVrm.ts`) with its head
 * scaled twice about the head bone, about twice the adult share of its
 * height, as chibi Avatars are built. Effects like the Included ones are
 * authored on adult heads; here they keep beside the head, at its size.
 */

class StubPath {
  moveTo() {}
  lineTo() {}
  closePath() {}
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("HTMLCanvasElement", StubCanvas);
  vi.stubGlobal("Path2D", StubPath);
  vi.stubGlobal("document", { createElement: () => new StubCanvas() });
  vi.mocked(loadEffectImage).mockImplementation(
    async () => new StubCanvas() as unknown as HTMLCanvasElement,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

/** Horns on top of the head, as the Included little-devil-horns. */
const HORNS = effect("horns", "emote", {
  kind: "face_landmark",
  landmark: "top_edge",
  position: "middle",
  scale: { x: 2.7, y: 2.7 },
});
/** A sparkle beside the head, as the Included kira_star in joy-2. */
const SPARKLE = effect("sparkle", "body", {
  kind: "body",
  bone: "head",
  facing: "camera",
  offset: { x: -0.1, y: 0.123, z: 0.138 },
  size: 0.065,
});
/** A bulb beside the head, as the Included idea_bulb. */
const BULB = effect("bulb", "sticker", {
  kind: "sticker",
  around: "head",
  offset: { x: 0.12, y: 0.09 },
  size: 0.12,
});
/** Crosses over both eyes, as the Included knockout-x-eyes. */
const CROSSES = effect("crosses", "eyes", {
  kind: "face_landmark",
  landmark: "eyes",
  mirror: true,
  side: "right",
});

async function applyAll(
  avatar: Avatar,
  effects: readonly ReturnType<typeof effect>[],
): Promise<AvatarVFXController> {
  const controller = new AvatarVFXController(avatar);
  avatar.vfxController = controller;
  for (const entry of effects) {
    await applyAvatarVFXEffectById({
      avatar,
      effectId: entry.id,
      effectEntry: entry,
    });
  }
  return controller;
}

const headNode = (avatar: Avatar) =>
  avatar.vrm!.humanoid.getNormalizedBoneNode("head")!;

/** Where an object's origin lies in the normalized head bone's space. */
function inHeadSpace(avatar: Avatar, object: THREE.Object3D): THREE.Vector3 {
  avatar.scene!.updateMatrixWorld(true);
  const head = headNode(avatar);
  return head.worldToLocal(object.getWorldPosition(new THREE.Vector3()));
}

function named(avatar: Avatar, name: string): THREE.Mesh {
  const found = avatar.scene!.getObjectByName(name);
  if (!found) throw new Error(`No object named ${name}`);
  return found as THREE.Mesh;
}

/** A plane mesh's drawn height (m): its geometry times its scale. */
const planeHeight = (mesh: THREE.Mesh) =>
  (mesh.geometry as THREE.PlaneGeometry).parameters.height * mesh.scale.y;

describe.each([1, 2] as const)("head art on a head scaled %s×", (scale) => {
  const chibi = scale === 2;

  it("puts top-edge art on the head, at the head's size", async () => {
    const avatar = await loadWholeBodyAvatar({ headScale: scale });
    const controller = await applyAll(avatar, [HORNS]);
    expect(controller.getSnapshot().warnings).toEqual([]);
    const proportions = measureAvatarProportions(avatar.vrm);
    const mesh = named(avatar, "horns:top-edge-middle");
    const centre = inHeadSpace(avatar, mesh.parent!.parent!.parent!);
    const faceTop = avatar.getFaceLandmarksSnapshot()!.faceBoundsLocal!.max.y;
    if (chibi) {
      // On top of the head and fringe, not inside it at the face's top.
      expect(centre.y).toBeCloseTo(proportions.headBox!.max.y, 5);
      expect(centre.y).toBeGreaterThan(faceTop);
      expect(planeHeight(mesh)).toBeCloseTo(
        0.08 * 2.7 * proportions.headScale,
        5,
      );
    } else {
      expect(centre.y).toBeCloseTo(faceTop, 5);
      expect(planeHeight(mesh)).toBeCloseTo(0.08 * 2.7, 5);
    }
  });

  it("keeps a sparkle on the head bone beside the head", async () => {
    const avatar = await loadWholeBodyAvatar({ headScale: scale });
    // The head as loaded, before the sparkle hangs under it.
    const box = measureHeadBounds(avatar.vrm!, headNode(avatar))!;
    await applyAll(avatar, [SPARKLE]);
    const proportions = measureAvatarProportions(avatar.vrm);
    const mesh = named(avatar, "AvatarAttachmentVFX:sparkle");
    // The plane's anchor, before the billboard turns it to a camera.
    const centre = inHeadSpace(avatar, mesh.parent!.parent!);
    const outside =
      centre.x < box.min.x ||
      centre.x > box.max.x ||
      centre.y > box.max.y ||
      centre.z > box.max.z;
    expect(outside).toBe(true);
    const size = chibi ? proportions.headScale : proportions.bodyScale;
    expect(centre.x).toBeCloseTo(-0.1 * size, 5);
    expect(centre.z).toBeCloseTo(0.138 * size, 5);
  });

  it("sizes a sticker around the head in proportion to the head", async () => {
    const avatar = await loadWholeBodyAvatar({ headScale: scale });
    // As the effects measure it, before any art is in the scene.
    const height = measureAvatarHeight(avatar.scene);
    await applyAll(avatar, [BULB]);
    const proportions = measureAvatarProportions(avatar.vrm);
    const mesh = named(avatar, "AvatarAttachmentVFX:bulb");
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.6, 4);
    camera.lookAt(0, 1.6, 0);
    camera.updateMatrixWorld(true);
    mesh.onBeforeRender(
      {} as THREE.WebGLRenderer,
      new THREE.Scene(),
      camera,
      mesh.geometry,
      mesh.material as THREE.Material,
      null as never,
    );
    const position = new THREE.Vector3();
    const size = new THREE.Vector3();
    mesh.matrixWorld.decompose(position, new THREE.Quaternion(), size);
    const head = headNode(avatar).getWorldPosition(new THREE.Vector3());
    // The billboard's scale is the unit offsets and size are measured in:
    // the Avatar's height, or around a big head the height an Included
    // Avatar with that face would have.
    const unit = chibi
      ? HEAD_STICKER_REFERENCE_HEIGHT * proportions.headScale
      : height;
    expect(size.y).toBeCloseTo(unit, 5);
    expect(position.x - head.x).toBeCloseTo(0.12 * unit, 5);
    if (chibi) {
      // Beside the head: its centre out past the head's side.
      expect(position.x - head.x).toBeGreaterThan(proportions.headBox!.max.x);
    }
  });
});

describe("eye overlays", () => {
  it("cover larger eyes with larger planes", async () => {
    const adult = await loadWholeBodyAvatar();
    const chibi = await loadWholeBodyAvatar({ headScale: 2 });
    const heights = await Promise.all(
      [adult, chibi].map(async (avatar) => {
        await applyAll(avatar, [CROSSES]);
        const eye = avatar.getFaceLandmarksSnapshot()!.eyes.left!;
        return {
          eye: eye.boundsLocal.size.y,
          plane: planeHeight(named(avatar, "crosses:left")),
        };
      }),
    );
    // The adult's eyes fit the authored plane; the chibi's are twice as tall.
    expect(heights[0]!.plane).toBeCloseTo(0.06, 5);
    expect(heights[1]!.eye).toBeCloseTo(2 * heights[0]!.eye, 5);
    expect(heights[1]!.plane).toBeCloseTo((0.06 * heights[1]!.eye) / 0.04, 5);
  });

  it.each([1, 0] as const)(
    "sit in front of the face over estimated eyes (VRM %s)",
    async (vrm) => {
      const avatar = await loadWholeBodyAvatar({ vrm });
      await applyAll(avatar, [CROSSES]);
      const landmarks = avatar.getFaceLandmarksSnapshot()!;
      const { left, right } = landmarks.eyes;
      const front = vrm === 0 ? -1 : 1;
      const spacing = Math.abs(left!.centerLocal.x - right!.centerLocal.x);
      // The painted strokes lie just in front of the face, 10 cm out.
      expect(left!.surfaceFrontZLocal! * front).toBeGreaterThan(0.1);
      for (const side of ["left", "right"] as const) {
        const eye = landmarks.eyes[side]!;
        const plane = inHeadSpace(
          avatar,
          named(avatar, `crosses:${side}`).parent!.parent!.parent!,
        );
        expect((plane.z - eye.surfaceFrontZLocal!) * front).toBeCloseTo(
          0.05 * spacing,
          5,
        );
      }
    },
  );
});

describe("eye overlays over a face behind its eyes", () => {
  it("keep their place part way to the face's front", async () => {
    const avatar = await loadWholeBodyAvatar();
    const snapshot = avatar.getFaceLandmarksSnapshot()!;
    // A surface measured 5 cm behind each eye never pulls the plane back.
    const behind = (eye: NonNullable<typeof snapshot.eyes.left>) => ({
      ...eye,
      surfaceFrontZLocal: eye.centerLocal.z - 0.05,
    });
    const moved = {
      ...snapshot,
      eyes: {
        left: behind(snapshot.eyes.left!),
        right: behind(snapshot.eyes.right!),
      },
    };
    avatar.getFaceLandmarksSnapshot = () => moved;
    await applyAll(avatar, [CROSSES]);
    for (const side of ["left", "right"] as const) {
      const eye = moved.eyes[side];
      const plane = inHeadSpace(
        avatar,
        named(avatar, `crosses:${side}`).parent!.parent!.parent!,
      );
      expect(plane.z).toBeCloseTo(
        eye.centerLocal.z +
          (eye.projectedFrontLocal.z - eye.centerLocal.z) * 0.35,
        5,
      );
    }
  });
});

describe("estimated eyes", () => {
  it("are at least 30% of the eye spacing across", async () => {
    const avatar = await loadWholeBodyAvatar();
    const { left, right } = avatar.getFaceLandmarksSnapshot()!.eyes;
    const spacing = Math.abs(left!.centerLocal.x - right!.centerLocal.x);
    // The painted strokes are 3 cm wide and 1 cm high; blink lowers them.
    for (const eye of [left!, right!]) {
      expect(eye.estimate).toBe("blink");
      expect(eye.boundsLocal.size.x).toBeCloseTo(0.3 * spacing, 5);
      expect(eye.boundsLocal.size.y).toBeCloseTo(0.3 * spacing, 5);
    }
    // Under-eye and cheek art take their size from the eyes.
    const anchors = avatar.getFaceTextureAnchorsSnapshot()!.anchors;
    expect(anchors.undereye.left!.referenceSizeLocal.width).toBeCloseTo(
      0.75 * 0.3 * spacing,
      5,
    );
  });
});
