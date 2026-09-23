import { describe, expect, it } from "vitest";

import {
  createPoseCreatorEventCatalog,
  accompanyingEventSound,
  withUnavailableEventOption,
  type PoseCreatorEventCatalogSource,
} from "./poseCreatorEventCatalog";

describe("Pose Creator equipped event catalog", () => {
  it("preserves exact equipped runtime IDs and excludes global catalog entries", () => {
    const source = {
      listAvatarVFX: () => [
        {
          id: "equipped-avatar",
          label: "Equipped Avatar",
          kind: "hover",
          region: "emote",
          sound: { onApply: "equipped-sfx" },
        },
      ],
      listParticleVFX: () => [
        {
          id: "user-particle-runtime",
          label: "Private Particle",
          defaultAnchor: "head",
          defaultDurationSec: 2,
          assetPath: "blob:private",
          defaultTransform: {
            offset: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            depthOffset: 0,
          },
        },
      ],
      listSceneVFX: (kind: "background_layers" | "focus_lines") => [
        {
          id: `equipped-${kind}`,
          label: `Equipped ${kind}`,
          sound: { onApply: "equipped-sfx" },
          kind,
        },
      ],
      listAudio: () => [
        {
          runtimeId: "equipped-sfx",
          label: "Equipped SFX",
          kind: "sfx",
          volume: 0.75,
          loop: false,
          autoplay: false,
          sizeBytes: null,
        },
      ],
    } as unknown as PoseCreatorEventCatalogSource;

    const catalog = createPoseCreatorEventCatalog(source);

    expect(catalog.validationRefs).toEqual({
      avatarVFXIds: ["equipped-avatar"],
      sceneBackgroundLayerPresetIds: ["equipped-background_layers"],
      sceneFocusLinePresetIds: ["equipped-focus_lines"],
      particleVFXIds: ["user-particle-runtime"],
      sfxCueIds: ["equipped-sfx"],
    });
    expect(catalog.avatarVFX[0]?.soundOnApply).toBe("equipped-sfx");
    expect(catalog.sceneFocus[0]?.soundOnApply).toBe("equipped-sfx");
    expect(
      accompanyingEventSound(
        {
          id: "scene",
          kind: "scene_vfx",
          presetId: "equipped-focus_lines",
          sceneKind: "focus_lines",
          time: 0,
        },
        catalog,
      )?.label,
    ).toBe("Equipped SFX");
    expect(
      accompanyingEventSound(
        { id: "avatar", kind: "avatar_vfx", effectId: "missing", time: 0 },
        catalog,
      ),
    ).toBeNull();
  });

  it("keeps an imported unavailable runtime ID visible without rewriting it", () => {
    expect(
      withUnavailableEventOption(
        [{ id: "equipped", label: "Equipped" }],
        "missing-import",
      ),
    ).toEqual([
      {
        id: "missing-import",
        label: "missing-import · unavailable",
        unavailable: true,
      },
      { id: "equipped", label: "Equipped" },
    ]);
  });
});
