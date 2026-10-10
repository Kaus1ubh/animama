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
  sceneEffects: [
    {
      alias: "joy-background",
      name: "Joy",
      // As the Included Joy background stores it.
      definition: {
        schema: "animama/scene-effect/1",
        kind: "background_layers",
        durationMs: null,
        dismissOnInput: false,
        coverUiOverlays: false,
        solid: { enabled: true, color: "#ffe869" },
        pattern: {
          enabled: true,
          pattern: "star",
          color: "#ffffff",
          size: 24,
          spacing: 18,
          opacity: 0.36,
        },
        marquee: {
          enabled: true,
          itemSize: 72,
          gap: 24,
          rowGap: 18,
          direction: "diagonal-up-left",
          itemRotationMode: "upright",
          itemRotationOffsetDeg: 0,
          speedPxPerSec: 170,
          opacity: 0.92,
          items: [
            { id: "star", kind: "image", label: "Star", image: "star.svg" },
          ],
        },
      },
      imageUrls: { "star.svg": "/__preview/media/ghi/star.svg" },
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

  it("resolves a Scene event's alias and kind to the entry the layers draw", async () => {
    const provider = new PreviewMediaProvider(media());
    const entry = await provider.loadSceneVFX(
      "background_layers",
      "joy-background",
    );
    expect(entry).toMatchObject({ id: "joy-background", label: "Joy" });
    expect(entry?.kind === "background_layers" && entry.marquee.items).toEqual([
      expect.objectContaining({ src: "/__preview/media/ghi/star.svg" }),
    ]);
    // A preset of another kind does not match, as in the runtime catalog.
    expect(
      provider.resolveSceneVFX("focus_lines", "joy-background"),
    ).toBeNull();
    expect(provider.listSceneVFX("background_layers")).toHaveLength(1);
  });

  it("reports a Scene Effect that cannot be drawn", () => {
    const provider = new PreviewMediaProvider(
      media({
        sceneEffects: [
          {
            alias: "unserved",
            name: "Unserved",
            definition: media().sceneEffects[0].definition,
            imageUrls: {},
          },
        ],
      }),
    );
    expect(
      provider.resolveSceneVFX("background_layers", "unserved"),
    ).toBeNull();
    expect(provider.getProblems()).toEqual([
      expect.stringMatching(/Scene Effect “unserved”/),
    ]);
  });

  it("swaps its effects when the playing source changes", async () => {
    const provider = new PreviewMediaProvider(media());
    provider.setMedia({
      avatarEffects: [],
      particleEffects: [],
      sceneEffects: [],
      notices: [],
    });
    expect(await provider.loadAvatarVFX("swirl")).toBeNull();
    expect(await provider.resolveParticleVFX("question-marks")).toBeNull();
    expect(
      provider.resolveSceneVFX("background_layers", "joy-background"),
    ).toBeNull();
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
      {
        id: "d2",
        time: 0.5,
        kind: "scene_vfx",
        sceneKind: "background_layers",
        presetId: "joy-background",
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
      "Scene Effect “kawaii-sparkles” has no resolved dependency, so it does not play.",
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
    expect(
      clipUsesMedia(
        clip([
          {
            id: "s",
            time: 0,
            kind: "scene_vfx",
            sceneKind: "focus_lines",
            presetId: "speed",
          },
        ]),
      ),
    ).toBe(true);
  });
});
