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
  getAvatarReactionClip,
  getIncludedReactionPool,
  parseAnimaPoseClip,
  sampleAnimaPoseClipActiveEventsAtTime,
  validateAnimaPoseClipEventCatalogRefs,
  type AnimaPoseClipEvent,
  type AnimaPoseClipV2,
} from "@/lib/avatar";
import { createAnimaPoseClipProgram } from "@/lib/avatar/poses/animaPoseClip/program";
import { PoseController } from "@/lib/avatar";
import { ReactionClipPlayer } from "@/lib/avatar/reaction/ReactionClipPlayer";
import { TRACKED_EMOTIONS } from "@/lib/emotion";

const INCLUDED_ROOT = join(process.cwd(), "../../../content/included");
const INCLUDED_AVATAR_EFFECT_ALIASES = readIncludedEffectAliases(
  "avatar_effect",
  "vfx/avatar",
);
const INCLUDED_PARTICLE_EFFECT_ALIASES = readIncludedEffectAliases(
  "particle_effect",
  "vfx/particle/quark",
);
const INCLUDED_BACKGROUND_EFFECT_ALIASES = readIncludedEffectAliases(
  "scene_effect",
  "vfx/scene",
  "background_layers",
);
const INCLUDED_FOCUS_LINE_EFFECT_ALIASES = readIncludedEffectAliases(
  "scene_effect",
  "vfx/scene",
  "focus_lines",
);

/**
 * The Included Reaction ids of one emotion's cells, in pool order (D14):
 * one at Mild, then a first and a second (`-b`) at Moderate to Intense.
 */
function includedReactionCells(emotion: string): Record<number, string[]> {
  return {
    1: [`${emotion}-1`],
    2: [`${emotion}-2`, `${emotion}-2-b`],
    3: [`${emotion}-3`, `${emotion}-3-b`],
    4: [`${emotion}-4`, `${emotion}-4-b`],
  };
}

/**
 * The subtle Avatar Effect an intensity-1 Reaction adds where two emotions'
 * faces stay alike (D19); every other intensity-1 Reaction has no effect.
 */
const INTENSITY_ONE_AVATAR_EFFECTS: Record<string, string> = {
  annoyance: "sigh_puff_droop",
  desire: "blush_band",
  disappointment: "gloomy_cloud",
  excitement: "kira_star",
};

/**
 * Ladder departures (R2): effect kinds a Reaction lacks at its step because
 * the owner removed them in the G2 review (2026-10-15) without a replacement.
 */
const LADDER_DEPARTURES: Record<string, Array<"avatar" | "particle">> = {
  "admiration-3-b": ["particle"],
  "amusement-3": ["particle"],
  "amusement-3-b": ["avatar", "particle"],
  "amusement-4-b": ["particle"],
  "anger-4": ["particle"],
  "caring-3": ["avatar"],
  "confidence-3": ["avatar"],
  "curiosity-2-b": ["avatar"],
  "curiosity-4": ["particle"],
  "curiosity-4-b": ["particle"],
  "desire-2-b": ["avatar"],
  "embarrassment-3": ["particle"],
  "embarrassment-3-b": ["particle"],
  "optimism-4-b": ["avatar"],
  "remorse-3-b": ["particle"],
  "sadness-3-b": ["particle"],
};

/** A clip's Avatar, Particle and Scene Effect aliases, by kind. */
function reactionEffects(clip: AnimaPoseClipV2) {
  const events: AnimaPoseClipEvent[] = clip.events ?? [];
  return {
    avatar: events.flatMap((event) =>
      event.kind === "avatar_vfx" ? [event.effectId] : [],
    ),
    particle: events.flatMap((event) =>
      event.kind === "particle_vfx" ? [event.effectId] : [],
    ),
    scene: events.flatMap((event) =>
      event.kind === "scene_vfx" ? [event.presetId] : [],
    ),
  };
}

/**
 * The aliases Included reactions bind Included effects of one content type
 * by: each reaction dependency of that type whose ref is the content ID of an
 * Included descriptor (`<root>/<item>/<item>.json`), of `definitionKind` when
 * given (a Scene Effect's background or focus lines). A dependency on a
 * missing effect contributes no alias, so a clip event naming it fails the
 * catalog check.
 */
function readIncludedEffectAliases(
  contentType: "avatar_effect" | "particle_effect" | "scene_effect",
  effectsFolder: string,
  definitionKind?: "background_layers" | "focus_lines",
): string[] {
  const effectsRoot = join(INCLUDED_ROOT, effectsFolder);
  const effectIds = new Set(
    readdirSync(effectsRoot)
      .filter((item) => statSync(join(effectsRoot, item)).isDirectory())
      .flatMap((item) => {
        const descriptor = join(effectsRoot, item, `${item}.json`);
        try {
          const { content_id, definition } = JSON.parse(
            readFileSync(descriptor, "utf8"),
          ) as { content_id: string; definition?: { kind?: string } };
          return !definitionKind || definition?.kind === definitionKind
            ? [content_id]
            : [];
        } catch {
          return [];
        }
      }),
  );
  const reactionsRoot = join(INCLUDED_ROOT, "reactions");
  const aliases = readdirSync(reactionsRoot).flatMap((item) => {
    const meta = JSON.parse(
      readFileSync(join(reactionsRoot, item, `${item}.meta.json`), "utf8"),
    ) as {
      dependencies?: Array<{
        ref: string;
        alias: string;
        content_type: string;
      }>;
    };
    return (meta.dependencies ?? [])
      .filter(
        (dependency) =>
          dependency.content_type === contentType &&
          effectIds.has(dependency.ref),
      )
      .map((dependency) => dependency.alias);
  });
  return [...new Set(aliases)].sort();
}

function createExpressionOnlyClip(
  overrides: Partial<AnimaPoseClipV2> = {},
): AnimaPoseClipV2 {
  return parseAnimaPoseClip({
    schema: "animaPoseClip/2.0",
    id: "test-reaction",
    name: "Test Reaction",
    role: "reaction",
    duration: 1,
    beats: [
      { id: "rest", label: "Rest", time: 0 },
      { id: "peak", label: "Peak", time: 1, ease: "easeInOutSine" },
    ],
    expressions: {
      happy: [
        { beat: "rest", v: 0 },
        { beat: "peak", v: 1 },
      ],
    },
    ...overrides,
  });
}

function createPlaybackScopedClip(
  overrides: Partial<AnimaPoseClipV2> = {},
): AnimaPoseClipV2 {
  return parseAnimaPoseClip({
    schema: "animaPoseClip/2.0",
    id: "test-playback-reaction",
    name: "Test Playback Reaction",
    role: "reaction",
    duration: 1,
    playback: {
      lifetime: {
        kind: "whileInteractionPhase",
        phases: ["talking"],
        scope: "activeRun",
      },
    },
    beats: [{ id: "peak", label: "Peak", time: 0 }],
    expressions: { happy: [{ beat: "peak", v: 1 }] },
    ...overrides,
  });
}

const INVALID_PAYLOAD = "Invalid animaPoseClip/2.0 payload";

describe("animaPoseClip legacy role metadata", () => {
  it("preserves omitted roles as absent and rejects unknown legacy roles", () => {
    const motionClip = parseAnimaPoseClip({
      schema: "animaPoseClip/2.0",
      id: "legacy-motion",
      name: "Legacy Motion",
      duration: 1,
      beats: [{ id: "rest", label: "Rest", time: 0 }],
      expressions: { happy: [{ beat: "rest", v: 0 }] },
    });

    expect(motionClip.role).toBeUndefined();
    expect(() =>
      parseAnimaPoseClip({
        ...motionClip,
        role: "ambient",
      }),
    ).toThrowError(INVALID_PAYLOAD);
  });

  it("holds the final sample of a playback-scoped clip past its duration", () => {
    const clip = createPlaybackScopedClip();

    expect(getAnimaPoseClipTimelineDuration(clip)).toBe(1);
    const program = createAnimaPoseClipProgram(clip, {
      resolvePose: () => null,
    });
    expect(program.sample(10).sample.expressions).toEqual({ happy: 1 });
  });

  it("rejects invalid playback and duration combinations", () => {
    expect(() =>
      parseAnimaPoseClip({
        ...createPlaybackScopedClip(),
        duration: undefined,
      }),
    ).toThrowError(INVALID_PAYLOAD);

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
    ).toThrowError(INVALID_PAYLOAD);
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
          presetId: "scene-vfx-emotion-joy",
          duration: 0.5,
        },
        {
          id: "particle-vfx",
          time: 0.15,
          kind: "particle_vfx",
          effectId: "heart-burst",
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
          effectId: "heart-burst",
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
      effectId: "heart-burst",
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
        effectId: "heart-burst",
        anchor: "face",
        duration: 0.5,
      },
      {
        id: "bad-offset",
        time: 0,
        kind: "particle_vfx",
        effectId: "heart-burst",
        duration: 0.5,
        transform: { offset: { x: Number.NaN } },
      },
      {
        id: "bad-scale",
        time: 0,
        kind: "particle_vfx",
        effectId: "heart-burst",
        duration: 0.5,
        transform: { scale: { x: 0 } },
      },
      {
        id: "bad-follow",
        time: 0,
        kind: "particle_vfx",
        effectId: "heart-burst",
        duration: 0.5,
        followAnchor: "yes",
      },
      {
        id: "bad-envelope",
        time: 0,
        kind: "particle_vfx",
        effectId: "heart-burst",
        envelope: {},
      },
    ];

    for (const event of invalidEvents) {
      expect(() =>
        createExpressionOnlyClip({
          events: [event as never],
        }),
      ).toThrowError(INVALID_PAYLOAD);
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
  it("loads every Included Reaction: one at Mild, two at Moderate to Intense", () => {
    const expectedClipIds = TRACKED_EMOTIONS.flatMap((emotion) =>
      Object.values(includedReactionCells(emotion)).flat(),
    ).sort();

    expect(expectedClipIds).toHaveLength(168);
    expect([...AVATAR_REACTION_CLIP_IDS].sort()).toEqual(expectedClipIds);
  });

  it("serves each cell's Included Reactions as its pool, as the starter policy does", () => {
    for (const emotion of TRACKED_EMOTIONS) {
      for (const [intensity, clipIds] of Object.entries(
        includedReactionCells(emotion),
      )) {
        const emotionalIntensity = Number(intensity) as 1 | 2 | 3 | 4;
        expect(
          getIncludedReactionPool({
            emotionalTone: emotion,
            emotionalIntensity,
          }),
          `${emotion} ${intensity}`,
        ).toEqual(clipIds);
        for (const clipId of clipIds)
          expect(getAvatarReactionClip(clipId)).toMatchObject({
            id: clipId,
            role: "reaction",
          });
      }
    }
  });

  it("keeps every reaction clip composable and catalog-referenced", () => {
    const eventCatalogs = {
      // Effects are descriptor-backed Included items; reactions bind them by
      // these dependency aliases.
      avatarVFXIds: INCLUDED_AVATAR_EFFECT_ALIASES,
      sceneBackgroundLayerPresetIds: INCLUDED_BACKGROUND_EFFECT_ALIASES,
      sceneFocusLinePresetIds: INCLUDED_FOCUS_LINE_EFFECT_ALIASES,
      particleVFXIds: INCLUDED_PARTICLE_EFFECT_ALIASES,
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

  // The ladder (R2) is guidance: each step's effect kinds are checked
  // exactly, except a recorded departure, which must still be missing.
  it("follows the Reaction ladder: Avatar, then Particle, then Scene Effects", () => {
    for (const clipId of AVATAR_REACTION_CLIP_IDS) {
      const [emotion, intensity, variant] = clipId.split("-");
      const effects = reactionEffects(getAvatarReactionClip(clipId));
      const departures = LADDER_DEPARTURES[clipId] ?? [];
      for (const kind of departures)
        expect(effects[kind], `${clipId} departure`).toEqual([]);
      if (intensity === "1") {
        const subtle = INTENSITY_ONE_AVATAR_EFFECTS[emotion!];
        expect(effects, clipId).toEqual({
          avatar: subtle ? [subtle] : [],
          particle: [],
          scene: [],
        });
        continue;
      }
      // Moderate adds one or two Avatar Effects; Strong adds a Particle
      // Effect; Intense adds a Scene Effect: the emotion's background for the
      // first Reaction, another Scene for the second.
      if (!departures.includes("avatar"))
        expect(effects.avatar, `${clipId} Avatar Effects`).not.toEqual([]);
      if (intensity === "2") {
        expect(effects.avatar.length, clipId).toBeLessThanOrEqual(2);
        expect(effects.particle, clipId).toEqual([]);
      } else if (!departures.includes("particle"))
        expect(effects.particle, `${clipId} Particle Effects`).not.toEqual([]);
      const background = `scene-vfx-emotion-${emotion}`;
      if (intensity !== "4") expect(effects.scene, clipId).toEqual([]);
      else if (!variant) expect(effects.scene, clipId).toEqual([background]);
      else {
        expect(effects.scene, `${clipId} Scene Effects`).not.toEqual([]);
        expect(effects.scene, clipId).not.toContain(background);
      }
    }
    // Every emotion's background is an Included Scene Effect.
    expect(INCLUDED_BACKGROUND_EFFECT_ALIASES).toEqual(
      expect.arrayContaining(
        TRACKED_EMOTIONS.map((emotion) => `scene-vfx-emotion-${emotion}`),
      ),
    );
  });

  it("makes each second Reaction differ from the first in expression and an effect (R15)", () => {
    for (const clipId of AVATAR_REACTION_CLIP_IDS) {
      if (!clipId.endsWith("-b")) continue;
      const firstId = clipId.slice(0, -"-b".length);
      const effectSet = (id: string) =>
        Object.values(reactionEffects(getAvatarReactionClip(id)))
          .flat()
          .sort();
      expect(effectSet(clipId), clipId).not.toEqual(effectSet(firstId));
      expect(getAvatarReactionClip(clipId).expressions, clipId).not.toEqual(
        getAvatarReactionClip(firstId).expressions,
      );
    }
  });

  it("plays each Mild Reaction's Avatar Effect without its sound", () => {
    // Owner rule (2026-10-12): the mildest level shows its effect silently.
    for (const clipId of AVATAR_REACTION_CLIP_IDS) {
      if (clipId.split("-")[1] !== "1") continue;
      for (const event of getAvatarReactionClip(clipId).events ?? [])
        if (event.kind === "avatar_vfx")
          expect(event.playAccompanyingSound, `${clipId} ${event.id}`).toBe(
            false,
          );
    }
  });

  it("keeps each intensity-1 Avatar Effect to that emotion's Mild Reaction", () => {
    for (const [emotion, effectId] of Object.entries(
      INTENSITY_ONE_AVATAR_EFFECTS,
    )) {
      const others = AVATAR_REACTION_CLIP_IDS.filter(
        (clipId) =>
          clipId.startsWith(`${emotion}-`) && clipId !== `${emotion}-1`,
      );
      expect(others).toHaveLength(6);
      for (const clipId of others)
        expect(
          reactionEffects(getAvatarReactionClip(clipId)).avatar,
          clipId,
        ).not.toContain(effectId);
    }
  });

  it("gives neutral, blank, unknown, group, or zero-intensity inputs no pool", () => {
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
        getIncludedReactionPool({
          emotionalTone,
          emotionalIntensity: 3,
        }),
      ).toEqual([]);
    }

    expect(
      getIncludedReactionPool({
        emotionalTone: "joy",
        emotionalIntensity: 0,
      }),
    ).toEqual([]);
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
            effectId: "heart-burst",
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

  it("applies and cleans up the real joy-4 particle VFX events", () => {
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
      clip: getAvatarReactionClip("joy-4"),
    });
    player.update(0.1);

    const appliedId = (effectId: string) =>
      `reaction:run-joy:emotion-event-joy:joy-4:particle-${effectId}`;
    expect(applied).toEqual([
      { id: appliedId("confetti"), effectId: "confetti", duration: 3.45 },
      { id: appliedId("star-burst"), effectId: "star-burst", duration: 1.8 },
    ]);

    player.update(1.85);
    expect(clearedIds).toEqual([appliedId("star-burst")]);
    player.update(1.7);
    expect(clearedIds).toEqual([
      appliedId("star-burst"),
      appliedId("confetti"),
    ]);
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

  it("keeps playback-scoped motion clip VFX active through fade-out", () => {
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
          effectId: "heart-burst",
          duration: 0.25,
        },
        {
          id: "particle-hold",
          time: 0,
          kind: "particle_vfx",
          effectId: "heart-burst",
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
