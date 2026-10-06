import { PerspectiveCamera } from "three";
import { describe, expect, it, vi } from "vitest";

import { Avatar } from "./Avatar";

/** A loaded-looking Avatar whose expression controller records isolation. */
function fixture() {
  const avatar = new Avatar(new PerspectiveCamera());
  const updateMatrixWorld = vi.fn();
  avatar.vrm = { scene: { updateMatrixWorld } } as unknown as Avatar["vrm"];
  const runWithTemporaryValues = vi.fn(
    (_values: Record<string, number>, run: () => unknown) => run(),
  );
  avatar.expressionController = {
    runWithTemporaryValues,
  } as unknown as Avatar["expressionController"];
  return { avatar, runWithTemporaryValues, updateMatrixWorld };
}

describe("Avatar.runWithPortraitCaptureState", () => {
  it("isolates the requested expression by default", () => {
    const { avatar, runWithTemporaryValues } = fixture();

    expect(avatar.runWithPortraitCaptureState("happy", () => "frame")).toBe(
      "frame",
    );
    expect(runWithTemporaryValues).toHaveBeenCalledWith(
      { happy: 1 },
      expect.any(Function),
    );
  });

  it("keeps live expressions without temporary values when asked", () => {
    const { avatar, runWithTemporaryValues, updateMatrixWorld } = fixture();

    expect(
      avatar.runWithPortraitCaptureState(null, () => "frame", {
        keepLiveExpressions: true,
      }),
    ).toBe("frame");
    expect(runWithTemporaryValues).not.toHaveBeenCalled();
    expect(updateMatrixWorld).toHaveBeenCalledWith(true);
  });
});
