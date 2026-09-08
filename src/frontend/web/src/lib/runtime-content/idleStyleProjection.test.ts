import { describe, expect, it } from "vitest";

import type {
  PyAnimaRuntime,
  PyRuntimeAvatar,
} from "@/lib/content/catalogTypes";
import {
  buildEmotionRuntimeState,
  createEmptyEmotionStateMap,
} from "@/lib/emotion";
import { AnimaRuntimeCatalog } from "./AnimaRuntimeCatalog";
import { adaptRuntimeSnapshot } from "./runtimeSnapshotAdapter";

function avatar(): PyRuntimeAvatar {
  return {
    source: {
      type: "catalog_item",
      item_id: "avatar-test",
      source: "included",
      revision: "builtin:avatar-test:1",
    },
    avatar_id: "avatar-test",
    revision: "builtin:avatar-test:1",
    files: [],
  };
}

function descriptor(): PyAnimaRuntime["content_descriptor"] {
  return {
    revision: "rcd1-test",
    total_bytes: 0,
    roots: [],
    entries: [],
    members: [],
    diagnostics: [],
  };
}

describe("typed Idle Style projection", () => {
  it("selects the dominant emotion pool and falls back to Default", () => {
    const runtime = adaptRuntimeSnapshot({
      catalog_version: 1,
      loadout_revision: 2,
      effective_revision: "idle-revision",
      lease_expires_at: "2026-08-12T00:00:00Z",
      content_descriptor: descriptor(),
      avatar: avatar(),
      gestures: [],
      reactions: [],
      particle_effects: [],
      avatar_effects: [],
      scene_effects: [],
      sound_effects: [],
      warnings: [],
      idle_style: {
        name: "Three moods",
        source: {
          type: "catalog_item",
          item_id: "builtin:idle-style:test",
          source: "included",
          revision: "builtin:idle-style:test:1",
        },
        revision: "builtin:idle-style:test:1",
        default_pool: ["neutral"],
        emotion_pools: { anger: ["angry", "neutral"], sadness: ["sad"] },
        cross_fade_seconds: 0.35,
        animations: [
          {
            animation_id: "neutral",
            name: "Neutral",
            playback: {
              duration_seconds: 3,
              loop_type: "pingpong",
              loop_count: 2,
            },
            files: [
              {
                file_ref: "idle-neutral",
                role: "animation",
                ordinal: 1,
                filename: "idle_sway.vrma",
                media_type: "model/gltf-binary",
                size_bytes: 10,
                sha256: "a".repeat(64),
                url: "/v1/content/files/idle-neutral",
              },
            ],
          },
          {
            animation_id: "angry",
            name: "Angry",
            playback: {
              duration_seconds: 3,
              loop_type: "pingpong",
              loop_count: 2,
            },
            files: [
              {
                file_ref: "idle-angry",
                role: "animation",
                ordinal: 1,
                filename: "idle_angry.vrma",
                media_type: "model/gltf-binary",
                size_bytes: 10,
                sha256: "b".repeat(64),
                url: "/v1/content/files/idle-angry",
              },
            ],
          },
          {
            animation_id: "sad",
            name: "Sad",
            playback: {
              duration_seconds: 3,
              loop_type: "pingpong",
              loop_count: 2,
            },
            files: [
              {
                file_ref: "idle-sad",
                role: "animation",
                ordinal: 1,
                filename: "idle_sad.vrma",
                media_type: "model/gltf-binary",
                size_bytes: 10,
                sha256: "c".repeat(64),
                url: "/v1/content/files/idle-sad",
              },
            ],
          },
        ],
      },
    } satisfies PyAnimaRuntime);
    const catalog = new AnimaRuntimeCatalog(runtime);
    const angryValues = createEmptyEmotionStateMap();
    angryValues.anger = 20;
    expect(
      catalog
        .evaluateIdleAnimations(buildEmotionRuntimeState(angryValues))
        .eligibleCandidates.map((row) => row.entry.id),
    ).toEqual(["neutral", "angry"]);
    const neutral = createEmptyEmotionStateMap();
    expect(
      catalog
        .evaluateIdleAnimations(buildEmotionRuntimeState(neutral))
        .eligibleCandidates.map((row) => row.entry.id),
    ).toEqual(["neutral"]);
    const previousFile = catalog
      .getIdleAnimations()
      .find((entry) => entry.id === "neutral")!.file;
    expect(
      catalog.selectIdleAnimation({
        emotionalState: buildEmotionRuntimeState(angryValues),
        randomRoll: 0,
        previousFile,
      }).selected?.entry.id,
    ).toBe("angry");
  });

  it("honors an intentionally empty style", () => {
    const runtime = adaptRuntimeSnapshot({
      catalog_version: 1,
      loadout_revision: 3,
      effective_revision: "empty-idle-revision",
      lease_expires_at: "2026-08-12T00:00:00Z",
      content_descriptor: descriptor(),
      avatar: avatar(),
      gestures: [],
      reactions: [],
      idle_style: null,
      particle_effects: [],
      avatar_effects: [],
      scene_effects: [],
      sound_effects: [],
      warnings: [],
    });
    expect(runtime.idle_animations).toEqual([]);
  });
});
