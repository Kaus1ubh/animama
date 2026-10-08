import { describe, expect, it } from "vitest";

import {
  avatarEffectEditorReducer,
  avatarEffectRuntimeEntry,
  createDefaultAvatarEffectDocument,
  suggestedAvatarEffectRegion,
  type AvatarEffectEditorAttachment,
  type AvatarEffectEditorDocument,
} from "@/lib/avatar/vfx/editor";
import type { AvatarVFXParsedEntry } from "@/lib/avatar/vfx/types";
import { inspectorTabForField } from "./AvatarEffectInspector";
import {
  avatarEffectPreviewApplyKey,
  avatarEffectPreviewChange,
} from "./avatarEffectCreatorBehavior";
import {
  placementOffsetPatch,
  placementRotationPatch,
  placementScalePatch,
  resolvedPlacement,
  sidesChoice,
  sidesChoicePatch,
  sidesChoices,
} from "./avatarEffectPlacement";

const image = {
  logicalName: "art.png",
  originalName: "art.png",
  contentType: "image/png",
  sizeBytes: 1,
  sha256: "a".repeat(64),
};

function document(
  attachment?: AvatarEffectEditorAttachment,
): AvatarEffectEditorDocument {
  const base = {
    ...createDefaultAvatarEffectDocument(),
    art: { image, otherEyeImage: null, flipbook: null },
  };
  return attachment
    ? { ...base, attachment, region: suggestedAvatarEffectRegion(attachment) }
    : base;
}

const entryOf = (value: AvatarEffectEditorDocument): AvatarVFXParsedEntry =>
  avatarEffectRuntimeEntry(value, { image: "blob:art" });

describe("Avatar Effect placement", () => {
  it("keeps fields and art in sync: a drag patch is what the preview applies", () => {
    let current = document();
    const before = entryOf(current);
    // A drag on the preview produces an attachment patch…
    const patch = placementOffsetPatch(current.attachment, {
      x: 0.0123,
      y: -0.004,
      z: 0.001,
    });
    current = avatarEffectEditorReducer(current, {
      type: "patch-attachment",
      patch,
    });
    // …which the Position fields read back…
    expect(resolvedPlacement(current.attachment)?.offset).toEqual({
      x: 0.0123,
      y: -0.004,
      z: 0.001,
    });
    // …and which reaches the applied art as an in-place transform update.
    const change = avatarEffectPreviewChange(before, entryOf(current));
    expect(change).toEqual({
      kind: "transform",
      transform: {
        kind: "face",
        transform: {
          offset: { x: 0.0123, y: -0.004, z: 0.001 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
        },
      },
    });
  });

  it("updates in place for placement edits and re-applies for everything else", () => {
    const base = document();
    const turned = avatarEffectEditorReducer(base, {
      type: "patch-attachment",
      patch: placementRotationPatch(base.attachment, 30)!,
    });
    const change = avatarEffectPreviewChange(entryOf(base), entryOf(turned));
    expect(change.kind).toBe("transform");
    expect(
      change.kind === "transform" && change.transform.kind === "face"
        ? change.transform.transform.rotation.z
        : null,
    ).toBeCloseTo(Math.PI / 6);

    const faded = avatarEffectEditorReducer(base, {
      type: "patch-appearance",
      patch: { opacity: 0.5 },
    });
    expect(avatarEffectPreviewChange(entryOf(base), entryOf(faded))).toEqual({
      kind: "reapply",
    });
    expect(avatarEffectPreviewChange(entryOf(base), entryOf(base))).toEqual({
      kind: "none",
    });

    const body = document({
      kind: "body",
      bone: "chest",
      size: 0.2,
      offset: { x: 0, y: 0, z: 0.1 },
    });
    const larger = avatarEffectEditorReducer(body, {
      type: "patch-attachment",
      patch: placementScalePatch(
        body.attachment,
        resolvedPlacement(body.attachment)!,
        2,
      )!,
    });
    expect(avatarEffectPreviewApplyKey(entryOf(body))).toBe(
      avatarEffectPreviewApplyKey(entryOf(larger)),
    );
    expect(avatarEffectPreviewChange(entryOf(body), entryOf(larger))).toEqual({
      kind: "transform",
      transform: {
        kind: "body",
        offset: { x: 0, y: 0, z: 0.1 },
        size: 0.4,
        rotation: 0,
      },
    });
  });

  it("clamps handle edits to the contract bounds", () => {
    const landmark = document().attachment;
    expect(
      placementScalePatch(landmark, resolvedPlacement(landmark)!, 100),
    ).toEqual({ scale: { x: 20, y: 20 } });
    expect(placementRotationPatch(landmark, 5000)).toEqual({
      rotationDeg: { x: 0, y: 0, z: 3600 },
    });
    expect(
      placementOffsetPatch(
        { kind: "face_surface", part: "face_skin", area: "full" },
        { x: 3, y: -0.25 },
      ),
    ).toEqual({ offset: { x: 2, y: -0.25 } });
    const sticker = { kind: "sticker", size: 1.5 } as const;
    expect(
      placementScalePatch(sticker, resolvedPlacement(sticker)!, 2),
    ).toEqual({ size: 2 });
  });

  it("offers plain side choices and maps them to /2 fields", () => {
    const eyes = document().attachment;
    expect(sidesChoices(eyes)).toEqual([
      "mirrored",
      "left",
      "right",
      "between",
    ]);
    expect(sidesChoice(eyes)).toBe("mirrored");
    const between = avatarEffectEditorReducer(document(), {
      type: "patch-attachment",
      patch: sidesChoicePatch(eyes, "between"),
    });
    expect(between.attachment).toEqual({
      kind: "face_landmark",
      landmark: "eyes",
    });

    const blush: AvatarEffectEditorAttachment = {
      kind: "face_surface",
      part: "face_skin",
      area: "blush",
      layout: "single",
      side: "left",
      mirror: true,
      pivot: "center",
    };
    expect(sidesChoices(blush)).not.toContain("both");
    const across = avatarEffectEditorReducer(document(blush), {
      type: "patch-attachment",
      patch: sidesChoicePatch(blush, "across"),
    });
    expect(across.attachment).toEqual({
      kind: "face_surface",
      part: "face_skin",
      area: "blush",
      layout: "span",
      pivot: "center",
    });
    expect(sidesChoice(across.attachment)).toBe("across");
    expect(sidesChoices({ kind: "body", bone: "chest" })).toEqual([]);
    // A converted or older mirrored pair without a side stays mirrored.
    const sideless: AvatarEffectEditorAttachment = {
      kind: "face_landmark",
      landmark: "eyes",
      mirror: true,
    };
    expect(sidesChoice(sideless)).toBe("mirrored");
    expect(sidesChoicePatch(sideless, "mirrored")).toEqual({
      side: "right",
      mirror: true,
    });
  });

  it("opens the Inspector tab that holds a failed Save's setting", () => {
    expect(inspectorTabForField("definition.attachment.offset.x")).toBe(
      "placement",
    );
    expect(inspectorTabForField("appearance.tint")).toBe("look");
    expect(inspectorTabForField("motion.keyframes.frames[1].t")).toBe("motion");
    expect(inspectorTabForField("attachment.landmark")).toBeNull();
    expect(inspectorTabForField(null)).toBeNull();
  });
});
