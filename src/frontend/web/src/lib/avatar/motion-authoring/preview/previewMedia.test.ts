import { describe, expect, it } from "vitest";

import type { AnimaPoseClipV2 } from "../../poses/animaPoseClip";
import type { EffectSource } from "../../vfx/effectSource";
import {
  PreviewMediaProvider,
  clipUsesMedia,
  previewMediaNotices,
  type PreviewMedia,
} from "./previewMedia";

const swirl: EffectSource = {
  stem: "eye_confused_swirl",
  contentId: "builtin:avatar-effect:eye_confused_swirl",
  name: "Eye Confused Swirl",
  description: "Swirling eyes.",
  definition: {
    schema: "animama/avatar-effect/2",
    region: "eyes",
    attachment: {
      kind: "face_landmark",
      landmark: "eyes",
      side: "right",
      mirror: true,
      scale: { x: 0.6, y: 0.6 },
    },
    art: { image: "eye_confused_swirl_r.png" },
  },
  imageUrl: "/__preview/media/abc/eye_confused_swirl_r.png?v=1",
  otherImageUrl: null,
};

const media = (overrides: Partial<PreviewMedia> = {}): PreviewMedia => ({
  avatarEffects: [{ alias: "swirl", effect: swirl }],
  particleEffects: [
    {
      alias: "question-marks",
      name: "Question Marks",
      description: "Floating question marks.",
      manifestUrl: "/__preview/media/def/particle.json",
      config: { anchor: "head", duration_seconds: 2, max_particles: 6 },
    },
  ],
  notices: [],
  ...overrides,
});

const clip = (events: AnimaPoseClipV2["events"]): AnimaPoseClipV2 => ({
  schema: "animaPoseClip/2.0",
  id: "confusion",
  name: "Confusion",
  duration: 1,
  beats: [],
  events,
});

describe("PreviewMediaProvider", () => {
  it("resolves a clip event's alias to the parsed effect and its served image", async () => {
    const provider = new PreviewMediaProvider(media());
    const entry = await provider.loadAvatarVFX("swirl");
    expect(entry).toMatchObject({
      id: "swirl",
      label: "Eye Confused Swirl",
      assetPath: swirl.imageUrl,
    });
    expect(provider.resolveAvatarVFX("swirl")).toBe(entry);
    expect(provider.listAvatarVFX()).toEqual([entry]);
    expect(await provider.loadAvatarVFX("unknown")).toBeNull();
    expect(provider.getProblems()).toEqual([]);
  });

  it("builds a Particle Effect from its manifest URL and runtime config", async () => {
    const particle = await new PreviewMediaProvider(media()).resolveParticleVFX(
      "question-marks",
    );
    expect(particle).toMatchObject({
      id: "question-marks",
      label: "Question Marks",
      assetPath: "/__preview/media/def/particle.json",
      defaultAnchor: "head",
      defaultDurationSec: 2,
      performanceBudget: { maxParticles: 6 },
    });
  });

  it("reports an invalid definition instead of failing silently", async () => {
    const provider = new PreviewMediaProvider(
      media({
        avatarEffects: [
          {
            alias: "broken",
            effect: {
              ...swirl,
              definition: { ...swirl.definition, region: "nowhere" },
            },
          },
        ],
      }),
    );
    expect(await provider.loadAvatarVFX("broken")).toBeNull();
    expect(provider.getProblems()).toEqual([
      expect.stringMatching(/“broken”.*definition\.region/),
    ]);
  });

  it("swaps its effects when the playing source changes", async () => {
    const provider = new PreviewMediaProvider(media());
    provider.setMedia({ avatarEffects: [], particleEffects: [], notices: [] });
    expect(await provider.loadAvatarVFX("swirl")).toBeNull();
    expect(await provider.resolveParticleVFX("question-marks")).toBeNull();
  });
});

describe("previewMediaNotices", () => {
  it("names effects that will not play and why", () => {
    const events: AnimaPoseClipV2["events"] = [
      { id: "a", time: 0.1, kind: "avatar_vfx", effectId: "swirl" },
      { id: "b", time: 0.1, kind: "avatar_vfx", effectId: "missing" },
      { id: "c", time: 0.2, kind: "particle_vfx", effectId: "question-marks" },
      {
        id: "d",
        time: 0.5,
        kind: "scene_vfx",
        sceneKind: "background_layers",
        presetId: "kawaii-sparkles",
      },
      { id: "e", time: 0.6, kind: "sfx", cueId: "pop" },
    ];
    expect(
      previewMediaNotices(
        clip(events),
        media({ notices: ["glow (local:x) does not play: gone"] }),
      ),
    ).toEqual([
      "glow (local:x) does not play: gone",
      "Avatar Effect “missing” has no resolved dependency, so it does not play.",
      "Scene Effect “kawaii-sparkles” (0.50 s) is not shown: the chat scene draws it.",
      "Sounds are not played in the preview.",
    ]);
    expect(previewMediaNotices(clip(events.slice(0, 1)), null)).toEqual([
      expect.stringMatching(/“swirl” does not play: a clip file has no/),
    ]);
  });

  it("knows which clips need media", () => {
    expect(clipUsesMedia(clip([]))).toBe(false);
    expect(
      clipUsesMedia(clip([{ id: "e", time: 0, kind: "sfx", cueId: "pop" }])),
    ).toBe(false);
    expect(
      clipUsesMedia(
        clip([{ id: "p", time: 0, kind: "particle_vfx", effectId: "stars" }]),
      ),
    ).toBe(true);
  });
});
