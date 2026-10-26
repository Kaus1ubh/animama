import { describe, expect, it } from "vitest";

import type { AvatarFaceLandmarksSnapshot } from "./landmark-types";
import {
  DEFAULT_AVATAR_VFX_MODEL_PROFILE,
  resolveIrisEyeLayout,
} from "./profiles";

const layout = DEFAULT_AVATAR_VFX_MODEL_PROFILE.eyeLayout!;

type Rect = [x: number, y: number, width: number, height: number];

/** Eye landmarks carrying only the texture rectangles the layout reads. */
function eyes(
  left: Rect | null,
  right: Rect | null,
): AvatarFaceLandmarksSnapshot["eyes"] {
  const eye = (rect: Rect | null) =>
    rect
      ? ({
          textureRect: {
            x: rect[0],
            y: rect[1],
            width: rect[2],
            height: rect[3],
          },
        } as NonNullable<AvatarFaceLandmarksSnapshot["eyes"]["left"]>)
      : null;
  return { left: eye(left), right: eye(right) };
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

  it("keeps the layout without both irises' rectangles", () => {
    expect(
      resolveIrisEyeLayout(layout, eyes([0.6, 0.05, 0.2, 0.2], null)),
    ).toBe(layout);
  });
});
