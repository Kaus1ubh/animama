import { describe, expect, it } from "vitest";

import {
  createPoseCreatorEventCatalog,
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
