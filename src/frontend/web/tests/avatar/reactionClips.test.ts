import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AVATAR_PARTICLE_VFX_CATALOG,
  AVATAR_REACTION_CLIP_IDS,
  analyzeAnimaPoseClipChannels,
  collectAnimaPoseClipEventsBetween,
  countAnimaPoseClipEventsByKind,
  getAnimaPoseClipTimelineDuration,
  getEmotionReactionClipId,
  getAvatarReactionClip,
  parseAnimaPoseClip,
  sampleAnimaPoseClip,
  sampleAnimaPoseClipActiveEventsAtTime,
  selectEmotionReactionClip,
  validateAnimaPoseClipEventCatalogRefs,
  type AnimaPoseClip,
  type AnimaPoseClipParticleVFXEvent,
} from "@/lib/avatar";
import { PoseController } from "@/lib/avatar";
import { ReactionClipPlayer } from "@/lib/avatar/reaction/ReactionClipPlayer";
import { AVATAR_VFX_CATALOG } from "@/lib/avatar/vfx/catalog";
import { TRACKED_EMOTIONS } from "@/lib/emotion";
import { getSceneBackgroundLayerPresetIds } from "@/lib/scene-vfx/catalog";

const emotionReactionIntensities = [1, 2, 3] as const;
const reactionParticleDurations = {
  hearts: 1.8,
  stars: 1.4,
  sparkles: 1.6,
  "question-marks": 2,
  exclamation: 1.2,
  "rain-cloud": 2.4,
} as const;
const expectedReactionParticleEffects = new Map<string, string>([
  ...buildReactionParticleMappings(
    ["admiration", "caring", "love", "desire"],
    [2, 3],
    "hearts",
  ),
  ...buildReactionParticleMappings(
    ["respect", "confidence", "gratitude", "optimism"],
    [2, 3],
    "sparkles",
  ),
  ...buildReactionParticleMappings(
    ["amusement", "excitement", "joy"],
    [2],
    "stars",
  ),
  ...buildReactionParticleMappings(
    ["amusement", "excitement", "joy"],
    [3],
    "sparkles",
  ),
  ...buildReactionParticleMappings(["curiosity"], [2], "question-marks"),
  ...buildReactionParticleMappings(["confusion"], [2, 3], "question-marks"),
  ...buildReactionParticleMappings(["curiosity"], [3], "exclamation"),
  ...buildReactionParticleMappings(
    ["disappointment", "grief", "sadness"],
    [2, 3],
    "rain-cloud",
  ),
]);

function buildReactionParticleMappings(
  emotions: readonly string[],
  intensities: readonly number[],
  effectId: string,
): Array<[string, string]> {
  return emotions.flatMap((emotion) =>
    intensities.map((intensity) => [`${emotion}-${intensity}`, effectId]),
  );
}

function createExpressionOnlyClip(
  overrides: Partial<AnimaPoseClip> = {},
): AnimaPoseClip {
  return parseAnimaPoseClip({
    schema: "animaPoseClip/1.0",
    id: "test-reaction",
    name: "Test Reaction",
    role: "reaction",
    duration: 1,
    poses: {
      rest: {
        expressions: {
          happy: 0,
        },
      },
      peak: {
        expressions: {
          happy: 1,
        },
      },
    },
    poseKeyframes: [
      {
        time: 0,
        pose: "rest",
      },
      {
        time: 1,
        pose: "peak",
      },
    ],
    ...overrides,
  });
}

function createPlaybackScopedClip(
  overrides: Partial<AnimaPoseClip> = {},
): AnimaPoseClip {
  return parseAnimaPoseClip({
    schema: "animaPoseClip/1.0",
    id: "test-playback-reaction",
    name: "Test Playback Reaction",
    role: "reaction",
    playback: {
      lifetime: {
        kind: "whileInteractionPhase",
        phases: ["talking"],
        scope: "activeRun",
      },
    },
    poses: {
      peak: {
        expressions: {
          happy: 1,
        },
      },
    },
    poseKeyframes: [
      {
        time: 0,
        pose: "peak",
      },
    ],
    ...overrides,
  });
}

describe("animaPoseClip legacy role metadata", () => {
  it("preserves omitted roles as absent and rejects unknown legacy roles", () => {
    const motionClip = parseAnimaPoseClip({
      schema: "animaPoseClip/1.0",
      id: "legacy-motion",
      name: "Legacy Motion",
      duration: 1,
      poses: {
        rest: {
          expressions: {
            happy: 0,
          },
        },
      },
      poseKeyframes: [
        {
          time: 0,
          pose: "rest",
        },
      ],
    });

    expect(motionClip.role).toBeUndefined();
    expect(() =>
      parseAnimaPoseClip({
        ...motionClip,
        role: "ambient",
      }),
    ).toThrowError("Invalid animaPoseClip/1.0 payload");
  });

  it("allows playback-scoped clips to omit duration and hold the final sample", () => {
    const clip = createPlaybackScopedClip();

    expect(clip.duration).toBeUndefined();
    expect(getAnimaPoseClipTimelineDuration(clip)).toBe(0);
    expect(sampleAnimaPoseClip(clip, 10).sample.expressions).toEqual({
      happy: 1,
    });
  });

  it("interpolates sparse expression channels against neutral zero", () => {
    const clip = parseAnimaPoseClip({
      schema: "animaPoseClip/1.0",
      id: "sparse-expression-reaction",
      name: "Sparse Expression Reaction",
      duration: 1,
      defaultTransition: {
        easing: "linear",
        interpolation: { expression: "linear" },
      },
      poses: {
        neutral: {},
        angry: { expressions: { angry: 1 } },
        sad: { expressions: { sad: 1 } },
      },
      poseKeyframes: [
        { time: 0, pose: "neutral" },
        { time: 0.5, pose: "angry" },
        { time: 1, pose: "sad" },
      ],
    });

    expect(sampleAnimaPoseClip(clip, 0.25).sample.expressions).toEqual({
      angry: 0.5,
    });
    expect(sampleAnimaPoseClip(clip, 0.75).sample.expressions).toEqual({
      angry: 0.5,
      sad: 0.5,
    });
  });

  it("rejects invalid playback and duration combinations", () => {
    expect(() =>
      parseAnimaPoseClip({
        schema: "animaPoseClip/1.0",
        id: "missing-duration",
        name: "Missing Duration",
        role: "reaction",
        poses: {
          peak: { expressions: { happy: 1 } },
        },
        poseKeyframes: [{ time: 0, pose: "peak" }],
      }),
    ).toThrowError("Invalid animaPoseClip/1.0 payload");

    expect(() =>
      parseAnimaPoseClip({
        ...createPlaybackScopedClip(),
        playback: {
          lifetime: {
            kind: "whileInteractionPhase",
            phases: ["not-a-phase"],
          },
        },
      }),
    ).toThrowError("Invalid animaPoseClip/1.0 payload");

    expect(() =>
      parseAnimaPoseClip({
        ...createPlaybackScopedClip(),
        loop: true,
      }),
    ).toThrowError("Invalid animaPoseClip/1.0 payload");
  });

  it("dispatches held playback events once instead of replaying during hold", () => {
    const clip = createPlaybackScopedClip({
      events: [
        {
          id: "sfx",
          time: 0,
          kind: "sfx",
          cueId: "Cute_02v1",
        },
      ],
    });

    expect(
      collectAnimaPoseClipEventsBetween(clip, 0, 0, {
        includeStart: true,
      }),
    ).toHaveLength(1);
    expect(collectAnimaPoseClipEventsBetween(clip, 1, 5)).toHaveLength(0);
  });

  it("analyzes expression and effect channels", () => {
    const clip = createExpressionOnlyClip({
      events: [
        {
          id: "avatar-vfx",
          time: 0,
          kind: "avatar_vfx",
          effectId: "star",
          duration: 0.5,
        },
        {
          id: "scene-vfx",
          time: 0.1,
          kind: "scene_vfx",
          sceneKind: "background_layers",
          presetId: "comic-pop",
          duration: 0.5,
        },
        {
          id: "particle-vfx",
          time: 0.15,
          kind: "particle_vfx",
          effectId: "hearts",
          anchor: "head",
          duration: 0.5,
        },
        {
          id: "sfx",
          time: 0.2,
          kind: "sfx",
          cueId: "Cute_02v1",
        },
      ],
    });

    expect(analyzeAnimaPoseClipChannels(clip)).toEqual({
      humanoid: false,
      expressions: true,
      avatarVfx: true,
      sceneVfx: true,
      particleVfx: true,
      sfx: true,
    });
  });

  it("parses particle VFX events and samples them as active VFX", () => {
    const clip = createExpressionOnlyClip({
      events: [
        {
          id: "particle-vfx",
          time: 0.25,
          kind: "particle_vfx",
          effectId: "hearts",
          anchor: "head",
          duration: 0.5,
          followAnchor: false,
          envelope: {},
          parameterKeyframes: [],
          transform: {
            offset: { x: 0.1, y: 0.2, z: 0.3 },
            depthOffset: 0.4,
            scale: { x: 0.5, y: 0.5, z: 0.5 },
          },
        },
      ],
    });

    expect(clip.events?.[0]).toMatchObject({
      id: "particle-vfx",
      kind: "particle_vfx",
      effectId: "hearts",
      anchor: "head",
      followAnchor: false,
      envelope: {},
      parameterKeyframes: [],
      transform: {
        offset: { x: 0.1, y: 0.2, z: 0.3 },
        depthOffset: 0.4,
        scale: { x: 0.5, y: 0.5, z: 0.5 },
      },
    });
    expect(countAnimaPoseClipEventsByKind(clip)).toMatchObject({
      total: 1,
      particleVFX: 1,
    });
    expect(sampleAnimaPoseClipActiveEventsAtTime(clip, 0.5)).toHaveLength(1);
    expect(sampleAnimaPoseClipActiveEventsAtTime(clip, 0.8)).toHaveLength(0);
  });

  it("rejects unsupported particle VFX event values", () => {
    const invalidEvents = [
      {
        id: "bad-anchor",
        time: 0,
        kind: "particle_vfx",
        effectId: "hearts",
        anchor: "face",
        duration: 0.5,
      },
      {
        id: "bad-offset",
        time: 0,
        kind: "particle_vfx",
        effectId: "hearts",
        duration: 0.5,
        transform: { offset: { x: Number.NaN } },
      },
      {
        id: "bad-scale",
        time: 0,
        kind: "particle_vfx",
        effectId: "hearts",
        duration: 0.5,
        transform: { scale: { x: 0 } },
      },
      {
        id: "bad-follow",
        time: 0,
        kind: "particle_vfx",
        effectId: "hearts",
        duration: 0.5,
        followAnchor: "yes",
      },
      {
        id: "bad-envelope",
        time: 0,
        kind: "particle_vfx",
        effectId: "hearts",
        envelope: {},
      },
    ];

    for (const event of invalidEvents) {
      expect(() =>
        createExpressionOnlyClip({
          events: [event as never],
        }),
      ).toThrowError("Invalid animaPoseClip/1.0 payload");
    }
  });

  it("reports missing particle VFX catalog ids", () => {
    const clip = createExpressionOnlyClip({
      events: [
        {
          id: "unknown-particle",
          time: 0,
          kind: "particle_vfx",
          effectId: "missing-particle",
        },
      ],
    });

    expect(
      validateAnimaPoseClipEventCatalogRefs(clip, {
        particleVFXIds: AVATAR_PARTICLE_VFX_CATALOG.map((entry) => entry.id),
      }),
    ).toEqual({
      missingAvatarVFXIds: [],
      missingSceneBackgroundLayerPresetIds: [],
      missingSceneFocusLinePresetIds: [],
      missingParticleVFXIds: ["missing-particle"],
      missingSFXCueIds: [],
    });
  });
});

describe("reaction clip catalog", () => {
  it("loads exactly the canonical tracked emotion clip grid from file names", () => {
    const expectedClipIds = TRACKED_EMOTIONS.flatMap((emotion) =>
      emotionReactionIntensities.map((intensity) => `${emotion}-${intensity}`),
    ).sort();

    expect([...AVATAR_REACTION_CLIP_IDS].sort()).toEqual(expectedClipIds);
  });

  it("resolves every tracked emotion and intensity to an existing clip", () => {
    for (const emotion of TRACKED_EMOTIONS) {
      for (const emotionalIntensity of emotionReactionIntensities) {
        const clipId = `${emotion}-${emotionalIntensity}`;
        expect(
          getEmotionReactionClipId({
            emotionalTone: emotion,
            emotionalIntensity,
          }),
        ).toBe(clipId);
        expect(
          selectEmotionReactionClip({
            emotionalTone: emotion,
            emotionalIntensity,
          }),
        ).toMatchObject({
          tone: emotion,
          intensity: emotionalIntensity,
          clipId,
          clip: {
            id: clipId,
            role: "reaction",
          },
        });
      }
    }
  });

  it("keeps every reaction clip composable and catalog-referenced", () => {
    const eventCatalogs = {
      // Angry and Exclamation are descriptor-backed Included items now. They
      // deliberately do not live in the code-shipped fallback registry.
      avatarVFXIds: [
        ...AVATAR_VFX_CATALOG.map((entry) => entry.id),
        "angry",
        "emote_!",
      ],
      sceneBackgroundLayerPresetIds: getSceneBackgroundLayerPresetIds(),
      sceneFocusLinePresetIds: [],
      particleVFXIds: AVATAR_PARTICLE_VFX_CATALOG.map((entry) => entry.id),
      sfxCueIds: [],
    };

    for (const clipId of AVATAR_REACTION_CLIP_IDS) {
      const clip = getAvatarReactionClip(clipId);
      const channelAnalysis = analyzeAnimaPoseClipChannels(clip);
      const eventDiagnostics = validateAnimaPoseClipEventCatalogRefs(
        clip,
        eventCatalogs,
      );

      expect(clip.role).toBe("reaction");
      expect(clip.playback?.lifetime).toEqual({
        kind: "whileInteractionPhase",
        phases: ["talking"],
        scope: "activeRun",
      });
      expect(channelAnalysis.expressions).toBe(true);
      expect(channelAnalysis.humanoid).toBe(false);
      expect(eventDiagnostics).toEqual({
        missingAvatarVFXIds: [],
        missingSceneBackgroundLayerPresetIds: [],
        missingSceneFocusLinePresetIds: [],
        missingParticleVFXIds: [],
        missingSFXCueIds: [],
      });
    }
  });

  it("authors Phase 5 particle events only on the selected high-intensity clips", () => {
    for (const clipId of AVATAR_REACTION_CLIP_IDS) {
      const clip = getAvatarReactionClip(clipId);
      const particleEvents = (clip.events ?? []).filter(
        (event): event is AnimaPoseClipParticleVFXEvent =>
          event.kind === "particle_vfx",
      );
      const expectedEffectId = expectedReactionParticleEffects.get(clipId);

      if (!expectedEffectId) {
        expect(particleEvents, `${clipId} should not have particles`).toEqual(
          [],
        );
        continue;
      }

      const intensity = Number(clipId.split("-").at(-1));
      const event = particleEvents[0];
      expect(particleEvents, `${clipId} particle count`).toHaveLength(1);
      expect(event).toMatchObject({
        id: `particle-${expectedEffectId}`,
        effectId: expectedEffectId,
        time: intensity === 3 ? 0.1 : 0.12,
        duration:
          reactionParticleDurations[
            expectedEffectId as keyof typeof reactionParticleDurations
          ],
      });
      expect("anchor" in event).toBe(false);
      expect("transform" in event).toBe(false);
      expect("followAnchor" in event).toBe(false);
    }
  });

  it("does not resolve neutral, blank, unknown, group, or zero-intensity inputs", () => {
    for (const emotionalTone of [
      null,
      undefined,
      "",
      "  ",
      "neutral",
      "unknown",
      "alarm",
      "delight",
      "rejection",
    ]) {
      expect(
        getEmotionReactionClipId({
          emotionalTone,
          emotionalIntensity: 3,
        }),
      ).toBeNull();
      expect(
        selectEmotionReactionClip({
          emotionalTone,
          emotionalIntensity: 3,
        }),
      ).toBeNull();
    }

    expect(
      getEmotionReactionClipId({
        emotionalTone: "joy",
        emotionalIntensity: 0,
      }),
    ).toBeNull();
    expect(
      selectEmotionReactionClip({
        emotionalTone: "joy",
        emotionalIntensity: 0,
      }),
    ).toBeNull();
  });

  it("does not retain old pilot-only reaction identifiers in active source", () => {
    const bannedPatterns = [
      ["PilotEmotion", "ReactionTone"].join(""),
      ["PILOT", "_REACTION"].join(""),
      ["resolvePilotEmotion", "ReactionTone"].join(""),
      ["pilot ", "reaction"].join(""),
    ];
    const sourceFiles = [
      ...collectSourceFiles(join(process.cwd(), "src")),
      ...collectSourceFiles(join(process.cwd(), "tests")),
    ];

    for (const filePath of sourceFiles) {
      const source = readFileSync(filePath, "utf8");
      for (const pattern of bannedPatterns) {
        expect(source, `${filePath} contains ${pattern}`).not.toContain(
          pattern,
        );
      }
    }
  });
});

function collectSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const filePath = join(root, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(filePath));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(filePath);
    }
  }
  return files;
}

describe("ReactionClipPlayer", () => {
  it("reports an inactive snapshot before playback starts", () => {
    const player = new ReactionClipPlayer({
      setExpressionOverlay: () => true,
      clearExpressionOverlay: () => true,
    });

    expect(player.getSnapshot()).toMatchObject({
      ready: true,
      active: false,
      clipId: null,
      eventCount: 0,
      firedEventCount: 0,
      activeEventCount: 0,
      expressionKeys: [],
    });
  });

  it("samples a roleless clip selected by the reaction lane", () => {
    const overlays: Array<Record<string, number>> = [];
    const player = new ReactionClipPlayer({
      setExpressionOverlay: (_ownerId, expressions) => {
        overlays.push({ ...expressions });
        return true;
      },
      clearExpressionOverlay: () => true,
    });

    player.play({
      ownerId: "reaction-owner",
      runId: "run-1",
      sourceEventId: "planner-event-1",
      emotionEventId: "emotion-event-1",
      clip: createExpressionOnlyClip({ role: undefined }),
    });
    player.update(0.5);

    expect(overlays[0]).toEqual({ happy: 0 });
    expect(overlays[1].happy).toBeCloseTo(0.5, 3);
  });

  it("reports active playback and event state in snapshots", () => {
    const player = new ReactionClipPlayer(
      {
        setExpressionOverlay: () => true,
        clearExpressionOverlay: () => true,
      },
      {
        eventSink: {
          applyAvatarVFX: () => {},
          clearAvatarVFX: () => {},
        },
      },
    );

    player.play({
      ownerId: "reaction-owner",
      runId: "run-1",
      sourceEventId: "planner-event-1",
      emotionEventId: "emotion-event-1",
      clip: createExpressionOnlyClip({
        events: [
          {
            id: "avatar-star",
            time: 0,
            kind: "avatar_vfx",
            effectId: "star",
          },
        ],
      }),
    });

    const snapshot = player.getSnapshot();
    expect(snapshot).toMatchObject({
      ready: true,
      active: true,
      clipId: "test-reaction",
      ownerId: "reaction-owner",
      runId: "run-1",
      sourceEventId: "planner-event-1",
      emotionEventId: "emotion-event-1",
      elapsedSec: 0,
      timelineDurationSec: 1,
      phase: "playing",
      eventCount: 1,
      firedEventCount: 1,
      activeEventCount: 1,
      eventDispatchAvailable: true,
      expressionKeys: ["happy"],
    });

    snapshot.expressionKeys.push("mutated");
    expect(player.getSnapshot().expressionKeys).toEqual(["happy"]);
  });

  it("namespaces avatar VFX event apply and cleanup ids", () => {
    const appliedIds: string[] = [];
    const clearedIds: string[] = [];
    const player = new ReactionClipPlayer(
      {
        setExpressionOverlay: () => true,
        clearExpressionOverlay: () => true,
      },
      {
        eventSink: {
          applyAvatarVFX: (_event, context) => {
            appliedIds.push(context.appliedId);
          },
          clearAvatarVFX: (_event, context) => {
            clearedIds.push(context.appliedId);
          },
        },
      },
    );

    player.play({
      ownerId: "reaction-owner",
      runId: "run-1",
      sourceEventId: "planner-event-1",
      emotionEventId: "emotion-event-1",
      clip: createExpressionOnlyClip({
        events: [
          {
            id: "avatar-star",
            time: 0,
            kind: "avatar_vfx",
            effectId: "star",
            duration: 0.5,
          },
        ],
      }),
    });
    player.update(0.5);

    expect(appliedIds).toEqual([
      "reaction:run-1:emotion-event-1:test-reaction:avatar-star",
    ]);
    expect(clearedIds).toEqual(appliedIds);
  });

  it("namespaces particle VFX event apply and cleanup ids", () => {
    const appliedIds: string[] = [];
    const clearedIds: string[] = [];
    const player = new ReactionClipPlayer(
      {
        setExpressionOverlay: () => true,
        clearExpressionOverlay: () => true,
      },
      {
        eventSink: {
          applyParticleVFX: (_event, context) => {
            appliedIds.push(context.appliedId);
          },
          clearParticleVFX: (_event, context) => {
            clearedIds.push(context.appliedId);
          },
        },
      },
    );

    player.play({
      ownerId: "reaction-owner",
      runId: "run-1",
      sourceEventId: "planner-event-1",
      emotionEventId: "emotion-event-1",
      clip: createExpressionOnlyClip({
        events: [
          {
            id: "particle-bang",
            time: 0,
            kind: "particle_vfx",
            effectId: "hearts",
            duration: 0.5,
          },
        ],
      }),
    });
    player.update(0.5);

    expect(appliedIds).toEqual([
      "reaction:run-1:emotion-event-1:test-reaction:particle-bang",
    ]);
    expect(clearedIds).toEqual(appliedIds);
  });

  it("applies and cleans up the real joy-3 particle VFX event", () => {
    const applied: Array<{ id: string; effectId: string; duration?: number }> =
      [];
    const clearedIds: string[] = [];
    const player = new ReactionClipPlayer(
      {
        setExpressionOverlay: () => true,
        clearExpressionOverlay: () => true,
      },
      {
        eventSink: {
          applyParticleVFX: (event, context) => {
            applied.push({
              id: context.appliedId,
              effectId: event.effectId,
              duration: event.duration,
            });
          },
          clearParticleVFX: (_event, context) => {
            clearedIds.push(context.appliedId);
          },
        },
      },
    );

    player.play({
      ownerId: "reaction-owner",
      runId: "run-joy",
      sourceEventId: "planner-event-joy",
      emotionEventId: "emotion-event-joy",
      clip: getAvatarReactionClip("joy-3"),
    });
    player.update(0.1);

    const expectedAppliedId =
      "reaction:run-joy:emotion-event-joy:joy-3:particle-sparkles";
    expect(applied).toEqual([
      {
        id: expectedAppliedId,
        effectId: "sparkles",
        duration: 1.6,
      },
    ]);

    player.update(1.6);
    expect(clearedIds).toEqual([expectedAppliedId]);
  });

  it("holds playback-scoped reactions until clear and then fades out", () => {
    const overlays: Array<Record<string, number>> = [];
    let overlayCleared = 0;
    const appliedIds: string[] = [];
    const clearedIds: string[] = [];
    const player = new ReactionClipPlayer(
      {
        setExpressionOverlay: (_ownerId, expressions) => {
          overlays.push({ ...expressions });
          return true;
        },
        clearExpressionOverlay: () => {
          overlayCleared += 1;
          return true;
        },
      },
      {
        eventSink: {
          applyAvatarVFX: (_event, context) => {
            appliedIds.push(context.appliedId);
          },
          clearAvatarVFX: (_event, context) => {
            clearedIds.push(context.appliedId);
          },
        },
      },
    );

    player.play({
      ownerId: "reaction-owner",
      runId: "run-1",
      sourceEventId: "planner-event-1",
      emotionEventId: "emotion-event-1",
      clip: createPlaybackScopedClip({
        fadeIn: { duration: 0.2 },
        fadeOut: { duration: 0.2 },
        events: [
          {
            id: "avatar-star",
            time: 0,
            kind: "avatar_vfx",
            effectId: "star",
          },
        ],
      }),
    });

    expect(overlays[0].happy ?? 0).toBe(0);
    expect(appliedIds).toHaveLength(1);
    player.update(0.2);
    expect(overlays.at(-1)?.happy).toBeCloseTo(1, 3);
    player.update(5);
    expect(player.isActive("reaction-owner")).toBe(true);
    expect(clearedIds).toHaveLength(0);

    expect(player.clear("reaction-owner")).toBe(false);
    player.update(0.1);
    expect(overlays.at(-1)?.happy).toBeCloseTo(0.5, 3);
    player.update(0.1);

    expect(player.isActive()).toBe(false);
    expect(overlayCleared).toBe(1);
    expect(clearedIds).toEqual(appliedIds);
  });

  it("reports fade-out phase and progress in snapshots", () => {
    const player = new ReactionClipPlayer({
      setExpressionOverlay: () => true,
      clearExpressionOverlay: () => true,
    });

    player.play({
      ownerId: "reaction-owner",
      runId: "run-1",
      sourceEventId: "planner-event-1",
      emotionEventId: null,
      clip: createPlaybackScopedClip({
        fadeOut: { duration: 0.2 },
      }),
    });

    expect(player.clear("reaction-owner")).toBe(false);
    expect(player.getSnapshot()).toMatchObject({
      active: true,
      phase: "fadeOut",
      fadeElapsedSec: 0,
      fadeOutDurationSec: 0.2,
    });

    player.update(0.1);
    expect(player.getSnapshot()).toMatchObject({
      active: true,
      phase: "fadeOut",
      fadeElapsedSec: 0.1,
      fadeOutDurationSec: 0.2,
    });
  });
});

describe("PoseController playback-scoped clips", () => {
  it("holds playback-scoped motion clips until stopped", () => {
    const expressionManager = {
      values: new Map<string, number>(),
      getExpression: (name: string) => (name === "happy" ? {} : null),
      getValue(name: string) {
        return this.values.get(name) ?? 0;
      },
      setValue(name: string, value: number) {
        this.values.set(name, value);
      },
      update: () => {},
    };
    const poseController = new PoseController({
      expressionManager,
      humanoid: {
        getNormalizedPose: () => ({}),
        setNormalizedPose: () => {},
        resetNormalizedPose: () => {},
        getNormalizedBoneNode: () => null,
      },
    } as never);

    const clip = parseAnimaPoseClip({
      ...createPlaybackScopedClip(),
      id: "motion-hold",
      name: "Motion Hold",
      role: "motion",
    });
    poseController.playAnimaPoseClip(clip);
    poseController.update(5);

    expect(poseController.isClipActive("motion-hold")).toBe(true);
    expect(expressionManager.getValue("happy")).toBe(1);

    poseController.stopClip({ immediate: true });
    expect(poseController.isClipActive("motion-hold")).toBe(false);
  });

  it("keeps no-duration motion clip VFX active through fade-out", () => {
    const expressionManager = {
      values: new Map<string, number>(),
      getExpression: (name: string) => (name === "happy" ? {} : null),
      getValue(name: string) {
        return this.values.get(name) ?? 0;
      },
      setValue(name: string, value: number) {
        this.values.set(name, value);
      },
      update: () => {},
    };
    const poseController = new PoseController({
      expressionManager,
      humanoid: {
        getNormalizedPose: () => ({}),
        setNormalizedPose: () => {},
        resetNormalizedPose: () => {},
        getNormalizedBoneNode: () => null,
      },
    } as never);
    const appliedIds: string[] = [];
    const clearedIds: string[] = [];
    poseController.setClipEventSink({
      applyAvatarVFX: (_event, context) => {
        appliedIds.push(context.appliedId);
      },
      clearAvatarVFX: (_event, context) => {
        clearedIds.push(context.appliedId);
      },
    });

    const clip = parseAnimaPoseClip({
      ...createPlaybackScopedClip(),
      id: "motion-vfx-hold",
      name: "Motion VFX Hold",
      role: "motion",
      fadeOut: { duration: 0.2 },
      events: [
        {
          id: "avatar-star",
          time: 0,
          kind: "avatar_vfx",
          effectId: "star",
        },
      ],
    });

    poseController.playAnimaPoseClip(clip);
    expect(appliedIds).toEqual(["poseClip:motion-vfx-hold:avatar-star"]);
    expect(
      poseController.getClipSnapshot("motion-vfx-hold").activeEventCount,
    ).toBe(1);

    expect(poseController.stopClip()).toBe(false);
    expect(clearedIds).toHaveLength(0);
    poseController.update(0.1);
    expect(
      poseController.getClipSnapshot("motion-vfx-hold").activeEventCount,
    ).toBe(1);
    poseController.update(0.1);

    expect(poseController.isClipActive("motion-vfx-hold")).toBe(false);
    expect(clearedIds).toEqual(appliedIds);
  });

  it("applies and clears motion clip particle VFX events", () => {
    const expressionManager = {
      values: new Map<string, number>(),
      getExpression: (name: string) => (name === "happy" ? {} : null),
      getValue(name: string) {
        return this.values.get(name) ?? 0;
      },
      setValue(name: string, value: number) {
        this.values.set(name, value);
      },
      update: () => {},
    };
    const poseController = new PoseController({
      expressionManager,
      humanoid: {
        getNormalizedPose: () => ({}),
        setNormalizedPose: () => {},
        resetNormalizedPose: () => {},
        getNormalizedBoneNode: () => null,
      },
    } as never);
    const appliedIds: string[] = [];
    const clearedIds: string[] = [];
    poseController.setClipEventSink({
      applyParticleVFX: (_event, context) => {
        appliedIds.push(context.appliedId);
      },
      clearParticleVFX: (_event, context) => {
        clearedIds.push(context.appliedId);
      },
    });

    const clip = parseAnimaPoseClip({
      ...createExpressionOnlyClip(),
      id: "motion-particle-vfx",
      name: "Motion Particle VFX",
      role: "motion",
      duration: 1,
      events: [
        {
          id: "particle-duration",
          time: 0,
          kind: "particle_vfx",
          effectId: "hearts",
          duration: 0.25,
        },
        {
          id: "particle-hold",
          time: 0,
          kind: "particle_vfx",
          effectId: "hearts",
        },
      ],
    });

    poseController.playAnimaPoseClip(clip);
    expect(appliedIds).toEqual([
      "poseClip:motion-particle-vfx:particle-duration",
      "poseClip:motion-particle-vfx:particle-hold",
    ]);

    poseController.update(0.25);
    expect(clearedIds).toEqual([
      "poseClip:motion-particle-vfx:particle-duration",
    ]);

    poseController.stopClip({ immediate: true });
    expect(clearedIds).toEqual(appliedIds);
  });
});
