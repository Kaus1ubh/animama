import { describe, expect, it } from "vitest";

import type {
  PyAnimaRuntimeAssets,
  PyRuntimeAssetEntry,
} from "@/lib/runtime-content/types";
import { buildAnimationPreloadPlan } from "@/lib/avatar/animationPreloadPlan";
import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import {
  createInitialAvatarPlannerState,
  planAvatar,
  type AvatarPlannerInput,
} from "@/lib/avatar/planner/AvatarPlanner";
import {
  buildEmotionRuntimeState,
  createEmptyEmotionStateMap,
} from "@/lib/emotion";
import { AnimaRuntimeCatalog } from "@/lib/runtime-content/AnimaRuntimeCatalog";

function emotionalState() {
  const values = createEmptyEmotionStateMap();
  values.joy = 12;
  return buildEmotionRuntimeState(values);
}

function plannerInput(
  overrides: Partial<AvatarPlannerInput> = {},
): AvatarPlannerInput {
  return {
    nowMs: 1_000,
    animaId: "anima:catalog-test",
    activeRunId: "run-1",
    interactionPhase: "idle",
    avatarState: "idle",
    emotionalState: emotionalState(),
    activeVrmaActions: [],
    activePlannerPoseClip: null,
    manualPoseClipActive: false,
    activePlannerProceduralLayerIds: [],
    manualProceduralLayerIds: [],
    eligiblePlannerProceduralLayerIds: [],
    pendingEvents: [],
    randomRolls: [0, 0, 0, 0],
    ...overrides,
  };
}

function userAnimation(
  slot: "idle_animation" | "gesture",
  runtimeId: string,
  url: string,
): PyRuntimeAssetEntry {
  return {
    slot,
    runtime_id: runtimeId,
    kind: "animation",
    display_name: runtimeId,
    description: null,
    config_schema_version: 1,
    config: {
      duration_seconds: 2,
      preload_tier: slot === "idle_animation" ? "tier_a" : "tier_b",
      loop_type: slot === "idle_animation" ? "repeat" : "once",
      loop_count: slot === "idle_animation" ? 2 : 1,
      emotion_weights: { joy: { "1": 1, "2": 1, "3": 1 } },
    },
    content_revision: `${runtimeId}-content-v1`,
    source: {
      type: "authorized_files",
      files: [
        {
          role: "animation",
          ordinal: 1,
          filename: `${runtimeId}.vrma`,
          content_type: "application/octet-stream",
          size_bytes: 128,
          content_revision: `${runtimeId}-file-v1`,
          url,
        },
      ],
    },
  };
}

function customRuntimeAssets(): PyAnimaRuntimeAssets {
  return {
    schema_version: 1,
    effective_revision: "custom-effective-v1",
    loadout_revision: 1,
    app_catalog_version: 1,
    avatar_model: {
      ...userAnimation(
        "idle_animation",
        "primary-placeholder",
        "https://example.test/model.vrm",
      ),
      slot: "primary_model",
      kind: "avatar_model",
    },
    idle_animations: [
      userAnimation(
        "idle_animation",
        "custom-idle",
        "https://example.test/custom-idle.vrma",
      ),
    ],
    gestures: [
      userAnimation(
        "gesture",
        "victory-dance",
        "https://example.test/victory-dance.vrma",
      ),
    ],
    poses: [],
    reactions: [],
    particle_vfx: [],
    avatar_vfx: [],
    scene_background_vfx: [],
    scene_focus_vfx: [],
    background_image: null,
    profile_image: null,
    sfx: [],
    bgm: [],
    warnings: [],
  };
}

describe("injected Avatar motion catalogs", () => {
  it("preserves Starter planning when its provider is supplied explicitly", () => {
    const previous = createInitialAvatarPlannerState();
    const input = plannerInput({
      idleStintQuietIntervalSec: 0,
    });

    expect(
      planAvatar(previous, {
        ...input,
        motionCatalog: BUILT_IN_AVATAR_MOTION_CATALOG,
      }),
    ).toEqual(planAvatar(previous, input));
    expect(buildAnimationPreloadPlan(BUILT_IN_AVATAR_MOTION_CATALOG)).toEqual(
      buildAnimationPreloadPlan(),
    );
  });

  it("picks built-in Reactions from each cell's Included pool", () => {
    const pick = (
      emotionalIntensity: 0 | 1 | 2 | 3 | 4,
      randomRoll: number,
      previousRuntimeId?: string,
    ) =>
      BUILT_IN_AVATAR_MOTION_CATALOG.getReactionRuntimeId({
        emotionalTone: "joy",
        emotionalIntensity,
        randomRoll,
        previousRuntimeId,
      });

    expect(BUILT_IN_AVATAR_MOTION_CATALOG.listReactionPools().joy).toEqual({
      "1": ["joy-1"],
      "2": ["joy-2", "joy-2-b"],
      "3": ["joy-3", "joy-3-b"],
      "4": ["joy-4", "joy-4-b"],
    });
    // A one-member cell always plays its member; two members split the roll
    // and never repeat the previous pick; intensity 0 plays nothing.
    expect(pick(1, 0.9, "joy-1")).toBe("joy-1");
    expect(pick(4, 0.2)).toBe("joy-4");
    expect(pick(4, 0.7)).toBe("joy-4-b");
    expect(pick(4, 0.2, "joy-4")).toBe("joy-4-b");
    expect(pick(0, 0.2)).toBeNull();
    for (const runtimeId of ["joy-1", "joy-4", "joy-4-b"])
      expect(
        BUILT_IN_AVATAR_MOTION_CATALOG.getReactionClip(runtimeId)?.id,
      ).toBe(runtimeId);
  });

  it("plans user idle and gesture VRMAs only from the mounted Anima catalog", () => {
    const catalog = new AnimaRuntimeCatalog(customRuntimeAssets(), {
      requestHeaders: async () => ({ Authorization: "Bearer test" }),
    });
    expect(catalog.listAnimations().map((entry) => entry.id)).toEqual([
      "custom-idle",
      "victory-dance",
    ]);
    const idleOutput = planAvatar(
      createInitialAvatarPlannerState(),
      plannerInput({
        idleStintQuietIntervalSec: 0,
        motionCatalog: catalog,
      }),
    );
    const idleAction = idleOutput.actions.find(
      (action) => action.type === "playVrmaLoop",
    );
    expect(idleAction?.plan).toMatchObject({
      clipName: "custom-idle",
      clipUrl: "https://example.test/custom-idle.vrma",
    });
    expect(idleAction?.plan.key).toContain("custom-idle-content-v1");

    const gestureOutput = planAvatar(
      createInitialAvatarPlannerState(),
      plannerInput({
        interactionPhase: "talking",
        avatarState: "talking",
        motionCatalog: catalog,
        pendingEvents: [
          {
            type: "gestureRequested",
            eventId: "motion-1",
            requestId: "gesture-1",
            runId: "run-1",
            animationHint: "victory-dance",
            sourceEventId: null,
            sourceEmotionEventId: null,
            createdAtMs: 1_000,
          },
        ],
      }),
    );
    const gestureAction = gestureOutput.actions.find(
      (action) => action.type === "playVrmaGesture",
    );
    expect(gestureAction?.plan).toMatchObject({
      clipName: "victory-dance",
      clipUrl: "https://example.test/victory-dance.vrma",
      manifestGestureId: "victory-dance",
    });

    expect(buildAnimationPreloadPlan(catalog)).toEqual({
      tierA: [
        expect.objectContaining({
          clipName: "custom-idle",
          clipUrl: "https://example.test/custom-idle.vrma",
        }),
      ],
      tierB: [
        expect.objectContaining({
          clipName: "victory-dance",
          clipUrl: "https://example.test/victory-dance.vrma",
        }),
      ],
    });
  });
});
