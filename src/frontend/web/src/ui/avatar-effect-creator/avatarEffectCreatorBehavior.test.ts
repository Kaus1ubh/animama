import { describe, expect, it, vi } from "vitest";

import {
  avatarEffectEditorReducer,
  createDefaultAvatarEffectDocument,
  type AvatarEffectEditorAttachmentKind,
} from "@/lib/avatar/vfx/editor";
import {
  AVATAR_EFFECT_PREVIEW_MOTION_CLASS,
  avatarEffectCreatorKeyboardAction,
  avatarEffectInitialView,
  avatarEffectPreviewCompatibility,
  createAvatarEffectObjectUrlLease,
} from "./avatarEffectCreatorBehavior";

describe("Avatar Effect creator behavior", () => {
  it("opens each attachment in a View that frames its art", () => {
    const attached = (
      kind: AvatarEffectEditorAttachmentKind,
      landmark?: "eyes" | "mouth" | "forehead" | "top" | "top_edge",
    ) => {
      let document = avatarEffectEditorReducer(
        createDefaultAvatarEffectDocument(),
        { type: "set-attachment", kind },
      );
      if (landmark)
        document = avatarEffectEditorReducer(document, {
          type: "patch-attachment",
          patch: { landmark },
        });
      return avatarEffectInitialView(document);
    };
    expect(avatarEffectInitialView(createDefaultAvatarEffectDocument())).toBe(
      "portrait-close",
    );
    expect(attached("face_surface")).toBe("portrait-close");
    expect(attached("face_landmark", "mouth")).toBe("portrait-close");
    // Face crops art above the head or on the forehead, as in Emote !.
    for (const landmark of ["forehead", "top", "top_edge"] as const)
      expect(attached("face_landmark", landmark)).toBe("portrait");
    expect(attached("body")).toBe("portrait");
    expect(attached("sticker")).toBe("portrait");
    expect(attached("silhouette")).toBe("full-body");
  });

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
