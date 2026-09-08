import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const avatarSource = new URL(
  "../avatar-effect-creator/AvatarEffectCreatorPage.tsx",
  import.meta.url,
);
const particleSource = new URL(
  "../particle-vfx-creator/ParticleVFXCreatorPage.tsx",
  import.meta.url,
);
const sceneSource = new URL(
  "../scene-effect-creator/SceneEffectCreatorPage.tsx",
  import.meta.url,
);

describe("effect creator primitive consumers", () => {
  it.each([
    ["Avatar", avatarSource],
    ["Particle", particleSource],
    ["Scene", sceneSource],
  ])(
    "keeps %s domain behavior behind the neutral presentation barrel",
    async (_, url) => {
      const source = await readFile(url, "utf8");

      expect(source).toContain('from "@/ui/content-creator"');
      expect(source).toContain("<CreatorWorkspaceShell");
      expect(source).toContain("<CreatorToolbar");
      expect(source).not.toContain("CreatorEditorPrimitives");
    },
  );

  it("keeps the Particle emitter timeline in its feature", async () => {
    const source = await readFile(particleSource, "utf8");

    expect(source).toContain("function ParticleVFXPreviewTimeline");
    expect(source).toContain("<CreatorPreviewBar");
    expect(source).toContain("function EmitterAuthoringTabs");
  });
});
