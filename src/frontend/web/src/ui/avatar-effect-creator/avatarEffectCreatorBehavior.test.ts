import { describe, expect, it, vi } from "vitest";

import {
  AVATAR_EFFECT_PREVIEW_MOTION_CLASS,
  avatarEffectCreatorKeyboardAction,
  avatarEffectPreviewCompatibility,
  createAvatarEffectObjectUrlLease,
  shouldBlockAvatarEffectNavigation,
} from "./avatarEffectCreatorBehavior";

describe("Avatar Effect creator behavior", () => {
  it("maps save and preview keyboard shortcuts without stealing text input space", () => {
    expect(
      avatarEffectCreatorKeyboardAction({
        key: "s",
        code: "KeyS",
        metaKey: true,
        ctrlKey: false,
        editing: true,
      }),
    ).toBe("save");
    expect(
      avatarEffectCreatorKeyboardAction({
        key: " ",
        code: "Space",
        metaKey: false,
        ctrlKey: false,
        editing: true,
      }),
    ).toBeNull();
    expect(
      avatarEffectCreatorKeyboardAction({
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
      shouldBlockAvatarEffectNavigation({
        dirty: true,
        busy: false,
        currentPath: "/a/avatar-effects/new",
        nextPath: "/a/library",
      }),
    ).toBe(true);
    expect(
      shouldBlockAvatarEffectNavigation({
        dirty: true,
        busy: false,
        currentPath: "/a/avatar-effects/new",
        nextPath: "/a/avatar-effects/new",
      }),
    ).toBe(false);
  });

  it("cleans up editor-owned object URLs exactly once", () => {
    const createObjectURL = vi.fn(() => "blob:effect-preview");
    const revokeObjectURL = vi.fn();
    const lease = createAvatarEffectObjectUrlLease({} as File, {
      createObjectURL,
      revokeObjectURL,
    });

    lease.dispose();
    lease.dispose();

    expect(lease.url).toBe("blob:effect-preview");
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:effect-preview");
  });

  it("declares reduced-motion-safe preview animation", () => {
    expect(AVATAR_EFFECT_PREVIEW_MOTION_CLASS).toContain(
      "motion-reduce:animate-none",
    );
  });

  it("keeps compatibility pending until the async effect application settles", () => {
    expect(
      avatarEffectPreviewCompatibility({
        playing: true,
        hasController: true,
        hasEffect: true,
        applySettled: false,
        activeEffectCount: 0,
      }),
    ).toBeNull();
    expect(
      avatarEffectPreviewCompatibility({
        playing: true,
        hasController: true,
        hasEffect: true,
        applySettled: true,
        activeEffectCount: 1,
      }),
    ).toBe(true);
    expect(
      avatarEffectPreviewCompatibility({
        playing: false,
        hasController: true,
        hasEffect: true,
        applySettled: true,
        activeEffectCount: 0,
      }),
    ).toBeNull();
  });
});
