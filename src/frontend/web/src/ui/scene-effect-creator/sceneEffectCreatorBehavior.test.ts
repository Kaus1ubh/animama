import { describe, expect, it, vi } from "vitest";

import {
  createSceneEffectObjectUrlLease,
  sceneEffectCreatorKeyboardAction,
  SCENE_EFFECT_PREVIEW_MOTION_CLASS,
  shouldBlockSceneEffectNavigation,
} from "./sceneEffectCreatorBehavior";

describe("Scene Effect creator behavior", () => {
  it("maps save and preview shortcuts without stealing input space", () => {
    expect(
      sceneEffectCreatorKeyboardAction({
        key: "s",
        code: "KeyS",
        metaKey: true,
        ctrlKey: false,
        editing: true,
      }),
    ).toBe("save");
    expect(
      sceneEffectCreatorKeyboardAction({
        key: " ",
        code: "Space",
        metaKey: false,
        ctrlKey: false,
        editing: true,
      }),
    ).toBeNull();
    expect(
      sceneEffectCreatorKeyboardAction({
        key: " ",
        code: "Space",
        metaKey: false,
        ctrlKey: false,
        editing: false,
      }),
    ).toBe("toggle-preview");
  });

  it("blocks only cross-route navigation while dirty or saving", () => {
    expect(
      shouldBlockSceneEffectNavigation({
        dirty: true,
        busy: false,
        currentPath: "/scene-effects/new",
        nextPath: "/library",
      }),
    ).toBe(true);
    expect(
      shouldBlockSceneEffectNavigation({
        dirty: true,
        busy: false,
        currentPath: "/scene-effects/new",
        nextPath: "/scene-effects/new",
      }),
    ).toBe(false);
  });

  it("releases every private-image preview URL exactly once", () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    const revokeObjectURL = vi.fn();
    const lease = createSceneEffectObjectUrlLease(
      [
        {
          logicalName: "first.webp",
          file: {} as File,
          sha256: "a".repeat(64),
        },
        {
          logicalName: "second.webp",
          file: {} as File,
          sha256: "b".repeat(64),
        },
      ],
      { createObjectURL, revokeObjectURL },
    );

    lease.dispose();
    lease.dispose();

    expect([...lease.urls]).toEqual([
      ["first.webp", "blob:first"],
      ["second.webp", "blob:second"],
    ]);
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, "blob:first");
    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, "blob:second");
  });

  it("declares reduced-motion-safe preview animation", () => {
    expect(SCENE_EFFECT_PREVIEW_MOTION_CLASS).toContain(
      "motion-reduce:animate-none",
    );
  });
});
