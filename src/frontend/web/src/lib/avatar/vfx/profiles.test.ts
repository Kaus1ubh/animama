import { describe, expect, it } from "vitest";

import type { AvatarFaceLandmarksSnapshot } from "./landmark-types";
import {
  DEFAULT_AVATAR_VFX_MODEL_PROFILE,
  resolveIrisEyeLayout,
} from "./profiles";

const layout = DEFAULT_AVATAR_VFX_MODEL_PROFILE.eyeLayout!;

type Rect = [x: number, y: number, width: number, height: number];

/**
 * Eye landmarks carrying only what the layout reads: texture rectangles and,
 * per `mirrored`, the Avatar's eyes whose UVs run mirrored against VRoid's.
 */
function eyes(
  left: Rect | null,
  right: Rect | null,
  mirrored: { left?: boolean; right?: boolean } = {},
): AvatarFaceLandmarksSnapshot["eyes"] {
  const eye = (rect: Rect | null, textureMirrored?: boolean) =>
    rect
      ? ({
          textureRect: {
            x: rect[0],
            y: rect[1],
            width: rect[2],
            height: rect[3],
          },
          ...(textureMirrored ? { textureMirrored } : {}),
        } as NonNullable<AvatarFaceLandmarksSnapshot["eyes"]["left"]>)
      : null;
  return {
    left: eye(left, mirrored.left),
    right: eye(right, mirrored.right),
  };
}

const rect = ([x, y, width, height]: Rect) => ({ x, y, width, height });

describe("resolveIrisEyeLayout", () => {
  it("keeps the VRoid layout when each iris sits in its half", () => {
    // As on Annie: the Avatar's left eye is on the texture's right half.
    const resolved = resolveIrisEyeLayout(
      layout,
      eyes([0.62, 0.21, 0.25, 0.56], [0.13, 0.21, 0.25, 0.56]),
    );
    expect(resolved).toBe(layout);
  });

  it("draws in a cell around each iris on a shared atlas, clipped to it", () => {
    // Irises side by side in the atlas's upper right, one across the middle.
    // The viewer's left is the Avatar's right eye.
    const viewerLeft: Rect = [0.4, 0.1, 0.2, 0.2];
    const viewerRight: Rect = [0.7, 0.1, 0.2, 0.2];
    const resolved = resolveIrisEyeLayout(
      layout,
      eyes(viewerRight, viewerLeft),
    );

    expect(resolved.clip).toEqual({
      left: rect(viewerLeft),
      right: rect(viewerRight),
    });
    expect(resolved.mirrorRight).toBe(layout.mirrorRight);
    // Cells keep each iris's centre and are about twice its size.
    for (const [cell, iris] of [
      [resolved.left, rect(viewerLeft)],
      [resolved.right, rect(viewerRight)],
    ] as const) {
      expect(cell.x + cell.width / 2).toBeCloseTo(iris.x + iris.width / 2);
      expect(cell.y + cell.height / 2).toBeCloseTo(iris.y + iris.height / 2);
      expect(cell.width / iris.width).toBeCloseTo(1.9);
      expect(cell.height / iris.height).toBeCloseTo(1.9);
    }
  });

  it("does not take irises inside their halves but off-centre for VRoid's", () => {
    // Small irises in the upper quadrants: inside the halves, yet a VRoid
    // half would centre the art below them.
    const resolved = resolveIrisEyeLayout(
      layout,
      eyes([0.6, 0.05, 0.2, 0.2], [0.1, 0.05, 0.2, 0.2]),
    );
    expect(resolved).not.toBe(layout);
    expect(resolved.clip?.left).toEqual(rect([0.1, 0.05, 0.2, 0.2]));
  });

  it("draws the same, unmirrored art when both eyes share one rectangle", () => {
    const shared: Rect = [0.6, 0.6, 0.3, 0.3];
    const resolved = resolveIrisEyeLayout(layout, eyes(shared, shared));
    expect(resolved.mirrorRight).toBe(false);
  });

  describe("eyes whose UVs run mirrored", () => {
    // Annie's iris rectangles, in their VRoid halves.
    const avatarLeft: Rect = [0.62, 0.21, 0.25, 0.56];
    const avatarRight: Rect = [0.13, 0.21, 0.25, 0.56];

    it("flips the mirrored eye's cell in a VRoid layout", () => {
      // The Avatar's left eye is the viewer's right cell.
      const resolved = resolveIrisEyeLayout(
        layout,
        eyes(avatarLeft, avatarRight, { left: true }),
      );
      expect(resolved).toEqual({
        ...layout,
        flipped: { left: false, right: true },
      });
    });

    it("flips each mirrored eye's own cell on an atlas", () => {
      const viewerLeft: Rect = [0.4, 0.1, 0.2, 0.2];
      const viewerRight: Rect = [0.7, 0.1, 0.2, 0.2];
      const resolved = resolveIrisEyeLayout(
        layout,
        eyes(viewerRight, viewerLeft, { right: true }),
      );
      expect(resolved.flipped).toEqual({ left: true, right: false });
      expect(resolved.mirrorRight).toBe(layout.mirrorRight);
    });

    it("draws one shared rectangle for the viewer's left eye", () => {
      const shared: Rect = [0.6, 0.6, 0.3, 0.3];
      // Mirrored UVs on the viewer's right eye already mirror its art.
      const mirroredRight = resolveIrisEyeLayout(
        layout,
        eyes(shared, shared, { left: true }),
      );
      expect(mirroredRight.mirrorRight).toBe(false);
      expect(mirroredRight.flipped).toBeUndefined();
      // Both draws flip together when the viewer's left eye is mirrored.
      const mirroredLeft = resolveIrisEyeLayout(
        layout,
        eyes(shared, shared, { right: true }),
      );
      expect(mirroredLeft.flipped).toEqual({ left: true, right: true });
    });
  });

  it("keeps the layout without both irises' rectangles", () => {
    expect(
      resolveIrisEyeLayout(layout, eyes([0.6, 0.05, 0.2, 0.2], null)),
    ).toBe(layout);
  });

  it("ignores an estimated eye's rectangle, which lies on the face texture", () => {
    // Atlas-like rectangles that would otherwise give each eye its own cell.
    const both = eyes([0.7, 0.1, 0.2, 0.2], [0.4, 0.1, 0.2, 0.2]);
    const estimated = (eye: (typeof both)["left"]) =>
      eye ? { ...eye, estimate: "blink" as const } : null;
    expect(
      resolveIrisEyeLayout(layout, { ...both, left: estimated(both.left) }),
    ).toBe(layout);
    expect(
      resolveIrisEyeLayout(layout, {
        left: estimated(both.left),
        right: estimated(both.right),
      }),
    ).toBe(layout);
  });
});
