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

/** An admitted idle Gesture with finite playback, as the runtime snapshot carries it. */
const gesture = (id: string, kind = "vrma") => ({
  binding_id: `idle:${id}`,
  runtime_root_id: `root-${id}`,
  source: { item_id: id },
  name: id,
  implementation: { kind },
  config: {},
  reference_map: {},
  idle_playback: {
    eligible: true,
    cycle_seconds: 0.5,
    time_scale: 2,
    repetitions: 2,
    duration_seconds: 0.5,
    loop_type: "repeat",
  },
  files: [
    {
      file_ref: id,
      role: kind === "vrma" ? "animation" : "sequence",
      ordinal: 1,
      filename: `${id}.json`,
      media_type: "application/json",
      size_bytes: 10,
      sha256: "a".repeat(64),
      url: `/v1/content/files/${id}`,
    },
  ],
});

describe("Idle pool projection", () => {
  it("mixes Default with an emotion's cells up to its intensity and never equips idle Gestures", () => {
    const typed = {
      catalog_version: 1,
      loadout_revision: 1,
      effective_revision: "v2",
      content_descriptor: descriptor(),
      avatar: avatar(),
      gestures: [],
      reactions: [],
      idle: {
        default_pool: ["sway"],
        // "missing" was not admitted, so joy 3 adds nothing to what it inherits.
        cells: { joy: { "2": ["wave"], "3": ["missing"] } },
        gestures: [gesture("sway", "vrma"), gesture("wave", "animaPoseClip")],
      },
    } as unknown as PyAnimaRuntime;
    const runtime = adaptRuntimeSnapshot(typed);
    const catalog = new AnimaRuntimeCatalog(runtime);
    const candidates = (joy: number) => {
      const values = createEmptyEmotionStateMap();
      values.joy = joy;
      return catalog.evaluateIdleAnimations(buildEmotionRuntimeState(values))
        .eligibleCandidates;
    };
    const weights = (joy: number) =>
      candidates(joy).map((row) => [row.entry.id, row.weight]);
    // No emotion, or an emotion with no Gestures yet: Default alone.
    expect(weights(0)).toEqual([["idle:sway", 1]]);
    expect(weights(10)).toEqual([["idle:sway", 1]]);
    // Joy 2 and joy 3 (which inherits joy 2): half Default, half joy.
    expect(weights(20)).toEqual([
      ["idle:sway", 1],
      ["idle:wave", 1],
    ]);
    expect(weights(30)).toEqual(weights(20));
    expect(candidates(20)[1]?.effectiveDurationSec).toBe(0.5);
    expect(runtime.idle_pools).toEqual({
      default: ["idle:sway"],
      cells: { joy: { "2": ["idle:wave"] } },
    });
    expect(runtime.gestures).toEqual([]);
    expect(catalog.getGesture("idle:wave")).toBeNull();
    expect(catalog.getGesture("wave")).toBeNull();
    expect(catalog.listPoseClips().map((clip) => clip.runtimeId)).toContain(
      "idle:wave",
    );
  });

  it("gives a Gesture in Default and in the emotion pool both shares", () => {
    const catalog = new AnimaRuntimeCatalog(
      adaptRuntimeSnapshot({
        catalog_version: 1,
        loadout_revision: 1,
        effective_revision: "shares",
        content_descriptor: descriptor(),
        avatar: avatar(),
        gestures: [],
        reactions: [],
        idle: {
          default_pool: ["a", "b"],
          cells: { sadness: { "1": ["c"], "3": ["a"] } },
          gestures: [gesture("a"), gesture("b"), gesture("c")],
        },
      } as unknown as PyAnimaRuntime),
    );
    const values = createEmptyEmotionStateMap();
    values.sadness = 30;
    const state = buildEmotionRuntimeState(values);
    expect(
      catalog
        .evaluateIdleAnimations(state)
        .eligibleCandidates.map((row) => [row.entry.id, row.weight]),
    ).toEqual([
      ["idle:a", 1],
      ["idle:b", 0.5],
      ["idle:c", 0.5],
    ]);
    // Rolls map onto those weights: a takes half, b and c a quarter each.
    const pick = (randomRoll: number) =>
      catalog.selectIdleAnimation({ emotionalState: state, randomRoll })
        .selected?.entry.id;
    expect([0.1, 0.49, 0.6, 0.9].map(pick)).toEqual([
      "idle:a",
      "idle:a",
      "idle:b",
      "idle:c",
    ]);
  });

  it("avoids the previous Gesture within its half and ignores unmounted members", () => {
    const runtime = adaptRuntimeSnapshot({
      catalog_version: 1,
      loadout_revision: 1,
      effective_revision: "avoidance",
      content_descriptor: descriptor(),
      avatar: avatar(),
      gestures: [],
      reactions: [],
      idle: {
        default_pool: ["a", "b"],
        cells: { joy: { "2": ["c"] } },
        gestures: [gesture("a"), gesture("b"), gesture("c")],
      },
    } as unknown as PyAnimaRuntime);
    // A member the snapshot names but that never mounted takes no share.
    runtime.idle_pools!.default.push("idle:unmounted");
    const catalog = new AnimaRuntimeCatalog(runtime);
    const values = createEmptyEmotionStateMap();
    values.joy = 20;
    const emotionalState = buildEmotionRuntimeState(values);
    const fileOf = (id: string) =>
      catalog.getIdleAnimations().find((entry) => entry.id === id)!.file;
    const weights = () =>
      catalog
        .evaluateIdleAnimations(emotionalState)
        .eligibleCandidates.map((row) => [row.entry.id, row.weight]);
    expect(weights()).toEqual([
      ["idle:a", 0.5],
      ["idle:b", 0.5],
      ["idle:c", 1],
    ]);
    // After a, Default offers only b; joy keeps its half.
    const pick = (previous: string, randomRoll: number) =>
      catalog.selectIdleAnimation({
        emotionalState,
        randomRoll,
        previousFile: fileOf(previous),
      }).selected?.entry.id;
    expect([0.1, 0.4, 0.6, 0.9].map((roll) => pick("idle:a", roll))).toEqual([
      "idle:b",
      "idle:b",
      "idle:c",
      "idle:c",
    ]);
    // c is joy's only Gesture, so it may repeat rather than leave Default the whole pool.
    expect([0.1, 0.4, 0.6, 0.9].map((roll) => pick("idle:c", roll))).toEqual([
      "idle:a",
      "idle:b",
      "idle:c",
      "idle:c",
    ]);
  });

  it("schedules nothing for an empty pool", () => {
    const runtime = adaptRuntimeSnapshot({
      catalog_version: 1,
      loadout_revision: 3,
      effective_revision: "empty-idle-revision",
      lease_expires_at: "2026-08-12T00:00:00Z",
      content_descriptor: descriptor(),
      avatar: avatar(),
      gestures: [],
      reactions: [],
      idle: { default_pool: [], cells: {}, gestures: [] },
      particle_effects: [],
      avatar_effects: [],
      scene_effects: [],
      sound_effects: [],
      warnings: [],
    });
    expect(runtime.idle_animations).toEqual([]);
    expect(
      new AnimaRuntimeCatalog(runtime).evaluateIdleAnimations(
        buildEmotionRuntimeState(createEmptyEmotionStateMap()),
      ).eligibleCandidates,
    ).toEqual([]);
  });
});
