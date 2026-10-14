import type { AvatarEffectDefinitionV2 } from "@animama/runtime-contracts/api-types";
import { describe, expect, it } from "vitest";

import { AvatarEffectDefinitionError } from "@/lib/avatar/vfx/definition";
import { avatarEffectEditorReducer } from "@/lib/avatar/vfx/editor";
import type {
  AnimaRuntimeCatalogSnapshot,
  RuntimeCatalogEntry,
} from "@/lib/runtime-content/types";
import {
  avatarEffectUseDocument,
  avatarEffectUseErrorField,
  avatarEffectUseOverride,
  avatarEffectUseSource,
  avatarEffectUseTransform,
  editAvatarEffectUse,
} from "./avatarEffectUse";

/** A body effect like Kira Star: placement, motion and a default sound. */
const STAR: AvatarEffectDefinitionV2 = {
  schema: "animama/avatar-effect/2",
  region: "body",
  attachment: {
    kind: "body",
    bone: "head",
    offset: { x: -0.1, y: 0.123, z: 0.138 },
    size: 0.065,
    facing: "camera",
  },
  art: { image: "kira_star.png" },
  motion: { pulse: { scaleMin: 0.92, scaleMax: 1.06, cyclesPerSecond: 1.5 } },
  soundAlias: "bell",
};

/** Mirrored eye art whose face option applies only to the eyes. */
const EYES: AvatarEffectDefinitionV2 = {
  schema: "animama/avatar-effect/2",
  region: "eyes",
  attachment: {
    kind: "face_landmark",
    landmark: "eyes",
    mirror: true,
    side: "right",
    scale: { x: 0.55, y: 0.55 },
  },
  art: { image: "eye_bar_r.png" },
  faceOptions: { hideParts: ["eye_highlight"] },
};

describe("avatarEffectUseDocument", () => {
  it("opens the effect's own placement, look and motion", () => {
    const document = avatarEffectUseDocument(STAR);
    // The contract's defaults are filled in (for example rotationDeg: 0).
    expect(document.attachment).toMatchObject(STAR.attachment);
    expect(document.appearance).toEqual({
      opacity: 1,
      tint: null,
      blend: "normal",
    });
    expect(document.motion).toEqual(STAR.motion);
    expect(document.art.image?.logicalName).toBe("kira_star.png");
  });

  it("opens a use with its override's parts", () => {
    const document = avatarEffectUseDocument(STAR, {
      attachment: { kind: "body", bone: "leftHand" },
      appearance: { opacity: 0.5 },
      motion: {},
    });
    expect(document.attachment).toMatchObject({
      kind: "body",
      bone: "leftHand",
    });
    expect(document.attachment).not.toHaveProperty("offset");
    expect(document.appearance.opacity).toBe(0.5);
    expect(document.motion).toEqual({});
  });

  it("refuses an override the effect cannot play", () => {
    expect(() =>
      avatarEffectUseDocument(EYES, {
        attachment: { kind: "face_landmark", landmark: "mouth" },
      }),
    ).toThrow(AvatarEffectDefinitionError);
  });
});

describe("avatarEffectUseOverride", () => {
  const edit = (
    definition: AvatarEffectDefinitionV2,
    action: Parameters<typeof avatarEffectEditorReducer>[1],
  ) => avatarEffectEditorReducer(avatarEffectUseDocument(definition), action);

  it("is empty for an unedited use", () => {
    expect(
      avatarEffectUseOverride(STAR, avatarEffectUseDocument(STAR)),
    ).toBeUndefined();
    expect(
      avatarEffectUseOverride(EYES, avatarEffectUseDocument(EYES)),
    ).toBeUndefined();
  });

  it("replaces only the changed part, whole", () => {
    expect(
      avatarEffectUseOverride(
        STAR,
        edit(STAR, { type: "patch-attachment", patch: { bone: "leftHand" } }),
      ),
    ).toEqual({
      attachment: {
        kind: "body",
        bone: "leftHand",
        offset: { x: -0.1, y: 0.123, z: 0.138 },
        size: 0.065,
        facing: "camera",
      },
    });
    expect(
      avatarEffectUseOverride(
        STAR,
        edit(STAR, { type: "patch-appearance", patch: { opacity: 0.5 } }),
      ),
    ).toEqual({ appearance: { opacity: 0.5 } });
  });

  it("writes an empty part when the use removes what the effect sets", () => {
    expect(
      avatarEffectUseOverride(
        STAR,
        edit(STAR, { type: "set-motion", motion: {} }),
      ),
    ).toEqual({ motion: {} });
  });

  it("is empty again after editing back to the effect", () => {
    const moved = edit(STAR, {
      type: "patch-attachment",
      patch: { bone: "leftHand" },
    });
    const back = avatarEffectEditorReducer(moved, {
      type: "patch-attachment",
      patch: { bone: "head" },
    });
    expect(avatarEffectUseOverride(STAR, back)).toBeUndefined();
    const faded = edit(STAR, {
      type: "patch-appearance",
      patch: { opacity: 0.4 },
    });
    expect(
      avatarEffectUseOverride(
        STAR,
        avatarEffectEditorReducer(faded, {
          type: "patch-appearance",
          patch: { opacity: 1 },
        }),
      ),
    ).toBeUndefined();
  });

  it("keeps a chosen sound only when it differs from the effect's", () => {
    const document = avatarEffectUseDocument(STAR);
    expect(avatarEffectUseOverride(STAR, document, "squeak")).toEqual({
      soundAlias: "squeak",
    });
    expect(avatarEffectUseOverride(STAR, document, "bell")).toBeUndefined();
  });
});

describe("editAvatarEffectUse", () => {
  it("applies an edit to the current override", () => {
    const result = editAvatarEffectUse(
      STAR,
      { appearance: { opacity: 0.5 }, soundAlias: "squeak" },
      { action: { type: "patch-attachment", patch: { size: 0.1 } } },
    );
    expect(result).toEqual({
      override: {
        attachment: { ...STAR.attachment, size: 0.1 },
        appearance: { opacity: 0.5 },
        soundAlias: "squeak",
      },
    });
  });

  it("drops a part that matches the effect again", () => {
    expect(
      editAvatarEffectUse(
        STAR,
        { attachment: structuredClone(STAR.attachment) },
        { action: { type: "patch-appearance", patch: { tint: "#ff0000" } } },
      ),
    ).toEqual({ override: { appearance: { tint: "#ff0000" } } });
  });

  it("chooses a sound, and the effect's own sound removes the choice", () => {
    expect(
      editAvatarEffectUse(STAR, undefined, { soundAlias: "squeak" }),
    ).toEqual({ override: { soundAlias: "squeak" } });
    expect(
      editAvatarEffectUse(
        STAR,
        { soundAlias: "squeak" },
        { soundAlias: "bell" },
      ),
    ).toEqual({ override: undefined });
  });

  it("refuses an edit the effect cannot play, naming the setting", () => {
    // The effect's face option applies only to eye art.
    const result = editAvatarEffectUse(EYES, undefined, {
      action: { type: "patch-attachment", patch: { landmark: "mouth" } },
    });
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toBeInstanceOf(AvatarEffectDefinitionError);
    expect(avatarEffectUseErrorField(result.error)).toBe("attachment");
  });
});

function entry(
  slot: RuntimeCatalogEntry["slot"],
  runtimeId: string,
  extra: Partial<RuntimeCatalogEntry> = {},
): RuntimeCatalogEntry {
  return {
    slot,
    runtime_id: runtimeId,
    kind: slot === "sfx" ? "audio" : "avatar_vfx",
    display_name: runtimeId,
    description: null,
    config_schema_version: 1,
    config: {},
    content_revision: "1",
    source: { type: "authorized_files", files: [] },
    ...extra,
  };
}

function runtime(
  avatarVFX: RuntimeCatalogEntry[],
  sfx: RuntimeCatalogEntry[],
): AnimaRuntimeCatalogSnapshot {
  return {
    effective_revision: "1",
    loadout_revision: 1,
    app_catalog_version: 1,
    avatar_model: null,
    idle_animations: [],
    gestures: [],
    poses: [],
    reactions: [],
    particle_vfx: [],
    avatar_vfx: avatarVFX,
    scene_background_vfx: [],
    scene_focus_vfx: [],
    background_image: null,
    profile_image: null,
    sfx,
    warnings: [],
  };
}

describe("avatarEffectUseSource", () => {
  const sounds = [
    entry("sfx", "sfx-bell", { display_name: "Bell" }),
    entry("sfx", "sfx-squeak", { display_name: "Squeak" }),
    entry("sfx", "sfx-chime", { display_name: "Chime" }),
  ];

  it("lists the effect's declared sounds, its default first", () => {
    const source = avatarEffectUseSource(
      runtime(
        [
          entry("avatar_vfx", "star", {
            definition: STAR as unknown as Record<string, unknown>,
            config: {
              runtime_reference_map: {
                squeak: "sfx-squeak",
                bell: "sfx-bell",
                chime: "sfx-chime",
                // Not mounted: plays silently, so it is not offered.
                missing: "sfx-missing",
              },
            },
          }),
        ],
        sounds,
      ),
      "star",
    );
    expect(source?.definition).toMatchObject(STAR);
    expect(source?.sounds).toEqual([
      { alias: "bell", label: "Bell" },
      { alias: "chime", label: "Chime" },
      { alias: "squeak", label: "Squeak" },
    ]);
  });

  it("is null when the effect or its definition is unavailable", () => {
    const snapshot = runtime(
      [
        entry("avatar_vfx", "legacy", {
          definition: { schema: "animama/avatar-effect/1" },
          definition_error: "avatar_effect_conversion_required",
        }),
        entry("avatar_vfx", "broken", { definition: { schema: "nope" } }),
      ],
      sounds,
    );
    expect(avatarEffectUseSource(snapshot, "missing")).toBeNull();
    expect(avatarEffectUseSource(snapshot, "legacy")).toBeNull();
    expect(avatarEffectUseSource(snapshot, "broken")).toBeNull();
    expect(avatarEffectUseSource(null, "star")).toBeNull();
  });
});

describe("avatarEffectUseTransform", () => {
  it("is the placement the use plays, for an in-place preview update", () => {
    expect(avatarEffectUseTransform(STAR, undefined)).toEqual({
      kind: "body",
      offset: { x: -0.1, y: 0.123, z: 0.138 },
      size: 0.065,
      rotation: 0,
    });
    expect(
      avatarEffectUseTransform(STAR, {
        attachment: { kind: "body", bone: "head", size: 0.1 },
      }),
    ).toEqual({
      kind: "body",
      offset: { x: 0, y: 0, z: 0 },
      size: 0.1,
      rotation: 0,
    });
    expect(avatarEffectUseTransform(EYES, undefined)).toMatchObject({
      kind: "face",
      transform: { scale: { x: 0.55, y: 0.55 } },
    });
  });
});
