import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { AvatarEffectDragSession } from "./avatarEffectDrag";
import {
  handleRotationDelta,
  handleScaleFactor,
  hitTestManipulation,
  planeDragOffset,
  pointerRay,
  projectWorldPoint,
  rayPlaneLocalPoint,
  screenPlacements,
  stickerDragOffset,
  surfaceDragOffset,
  type ScreenPlacement,
} from "./directManipulation";

const VIEW = { width: 400, height: 400 };

/** A camera on +z looking at the origin, as the creator's Face view does. */
function frontCamera() {
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10);
  camera.position.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

function square(center: { x: number; y: number }, half = 20): ScreenPlacement {
  return {
    index: 0,
    label: "art",
    mirrored: false,
    rotationSense: 1,
    corners: [
      { x: center.x - half, y: center.y - half },
      { x: center.x + half, y: center.y - half },
      { x: center.x + half, y: center.y + half },
      { x: center.x - half, y: center.y + half },
    ],
    center,
    rotateHandle: { x: center.x, y: center.y - half - 28 },
  };
}

describe("Avatar Effect direct manipulation maths", () => {
  it("moves face-surface art by the UV distance, mirrored on the mirrored copy", () => {
    const start = { x: 0.01, y: -0.02 };
    const moved = { startUv: { x: 0.3, y: 0.5 }, uv: { x: 0.35, y: 0.47 } };
    const primary = surfaceDragOffset({
      startOffset: start,
      ...moved,
      mirrored: false,
    });
    expect(primary.x).toBeCloseTo(0.06);
    expect(primary.y).toBeCloseTo(-0.05);
    // The effect's own mirrored copy moves its offset the other way in x only.
    const mirrored = surfaceDragOffset({
      startOffset: start,
      ...moved,
      mirrored: true,
    });
    expect(mirrored.x).toBeCloseTo(-0.04);
    expect(mirrored.y).toBeCloseTo(-0.05);
  });

  it("moves plane art in its frame's x–y plane and keeps its depth", () => {
    const start = { x: 0.01, y: 0.02, z: 0.03 };
    const drag = {
      startLocal: { x: 0.1, y: 0.1 },
      local: { x: 0.12, y: 0.05 },
    };
    const primary = planeDragOffset({
      startOffset: start,
      ...drag,
      mirrored: false,
    });
    expect(primary.x).toBeCloseTo(0.03);
    expect(primary.y).toBeCloseTo(-0.03);
    expect(primary.z).toBe(0.03);
    expect(
      planeDragOffset({ startOffset: start, ...drag, mirrored: true }).x,
    ).toBeCloseTo(-0.01);
  });

  it("finds where a pointer ray crosses a turned and moved frame's plane", () => {
    const camera = frontCamera();
    // A head frame turned half a turn (as VRM 0 faces) and lifted.
    const frame = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 0.1, 0),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.PI,
      ),
      new THREE.Vector3(1, 1, 1),
    );
    const target = new THREE.Vector3(0.05, 0.12, 0.02).applyMatrix4(frame);
    const screen = projectWorldPoint(target, camera, VIEW.width, VIEW.height)!;
    const local = rayPlaneLocalPoint(
      pointerRay(screen, camera, VIEW.width, VIEW.height),
      frame,
      0.02,
    )!;
    expect(local.x).toBeCloseTo(0.05, 4);
    expect(local.y).toBeCloseTo(0.12, 4);
    expect(local.z).toBeCloseTo(0.02, 6);
  });

  it("moves stickers in screen units of the avatar's height", () => {
    const camera = frontCamera();
    const offset = stickerDragOffset({
      startOffset: { x: 0.1, y: 0 },
      startWorld: new THREE.Vector3(0, 0, 0),
      world: new THREE.Vector3(0.16, -0.08, 0),
      camera,
      unitLength: 1.6,
    });
    expect(offset.x).toBeCloseTo(0.2);
    expect(offset.y).toBeCloseTo(-0.05);
  });

  it("scales by the corner's distance from the centre", () => {
    expect(
      handleScaleFactor({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 25 }),
    ).toBeCloseTo(2.5);
    // A press on the centre itself cannot scale.
    expect(
      handleScaleFactor({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 0 }),
    ).toBe(1);
  });

  it("turns by the handle's angle, with the art's handedness and rotation sense", () => {
    const placement = square({ x: 100, y: 100 });
    const start = { x: 100, y: 50 };
    // A quarter turn clockwise on screen (y points down).
    const current = { x: 150, y: 100 };
    expect(handleRotationDelta({ placement, start, current })).toBeCloseTo(90);
    expect(
      handleRotationDelta({
        placement: { ...placement, rotationSense: -1 },
        start,
        current,
      }),
    ).toBeCloseTo(-90);
    // A horizontally flipped image on screen reverses it again.
    const [topLeft, topRight, bottomRight, bottomLeft] = placement.corners;
    expect(
      handleRotationDelta({
        placement: {
          ...placement,
          corners: [topRight, topLeft, bottomLeft, bottomRight],
        },
        start,
        current,
      }),
    ).toBeCloseTo(-90);
  });

  it("hits the rotate handle, then corners, then the art", () => {
    const placements = [square({ x: 100, y: 100 })];
    expect(hitTestManipulation(placements, { x: 100, y: 52 })?.mode).toBe(
      "rotate",
    );
    expect(hitTestManipulation(placements, { x: 121, y: 79 })?.mode).toBe(
      "scale",
    );
    expect(hitTestManipulation(placements, { x: 105, y: 100 })?.mode).toBe(
      "move",
    );
    expect(hitTestManipulation(placements, { x: 200, y: 200 })).toBeNull();
  });

  it("projects a frame's corners and puts the rotate handle beyond the top edge", () => {
    const camera = frontCamera();
    const corners = [
      new THREE.Vector3(-0.05, 0.05, 0),
      new THREE.Vector3(0.05, 0.05, 0),
      new THREE.Vector3(0.05, -0.05, 0),
      new THREE.Vector3(-0.05, -0.05, 0),
    ] as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const [placement] = screenPlacements(
      {
        attachment: "sticker",
        placements: [
          {
            label: "sticker",
            mirrored: false,
            rotationSense: -1,
            corners,
            center: new THREE.Vector3(),
          },
        ],
        offsetSpace: null,
        surface: null,
        unitLength: 1.6,
      },
      camera,
      VIEW.width,
      VIEW.height,
    );
    expect(placement!.center.x).toBeCloseTo(200);
    expect(placement!.corners[0].y).toBeLessThan(placement!.center.y);
    expect(placement!.rotateHandle.y).toBeCloseTo(placement!.corners[0].y - 28);
  });

  it("drags landmark art so it follows the pointer, through a whole session", () => {
    const camera = frontCamera();
    const view = { camera, ...VIEW };
    const center = new THREE.Vector3(0, 0, 0.05);
    const corners = [-1, 1].flatMap((y) =>
      [-1, 1].map((x) => new THREE.Vector3(x * 0.02, -y * 0.02, 0.05)),
    );
    const frame = {
      attachment: "face_landmark" as const,
      placements: [
        {
          label: "right",
          mirrored: false,
          rotationSense: -1 as const,
          corners: [corners[0]!, corners[1]!, corners[3]!, corners[2]!] as [
            THREE.Vector3,
            THREE.Vector3,
            THREE.Vector3,
            THREE.Vector3,
          ],
          center,
        },
      ],
      offsetSpace: new THREE.Matrix4(),
      surface: null,
      unitLength: null,
    };
    const [placement] = screenPlacements(
      frame,
      camera,
      VIEW.width,
      VIEW.height,
    );
    const patches: unknown[] = [];
    const session = AvatarEffectDragSession.begin({
      hit: { mode: "move", placement: placement! },
      pointer: placement!.center,
      frame,
      attachment: {
        kind: "face_landmark",
        landmark: "eyes",
        offset: { x: 0, y: 0, z: 0.05 },
      },
      view,
      target: {
        beginGroup: () => patches.push("begin"),
        endGroup: () => patches.push("end"),
        apply: (patch) => patches.push(patch),
      },
    })!;
    const target = projectWorldPoint(
      new THREE.Vector3(0.01, 0.02, 0.05),
      camera,
      VIEW.width,
      VIEW.height,
    )!;
    session.move(target, view);
    session.end();
    expect(patches[0]).toBe("begin");
    expect(patches.at(-1)).toBe("end");
    const patch = patches[1] as { offset: { x: number; y: number; z: number } };
    expect(patch.offset.x).toBeCloseTo(0.01, 4);
    expect(patch.offset.y).toBeCloseTo(0.02, 4);
    expect(patch.offset.z).toBeCloseTo(0.05, 6);
  });
});
