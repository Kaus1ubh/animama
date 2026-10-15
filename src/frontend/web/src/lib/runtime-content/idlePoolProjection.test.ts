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

describe("Idle pool projection", () => {
  it("selects exact cells, uses Default for empty cells and never equips idle Gestures", () => {
    const gesture = (id: string, kind: string) => ({
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
        // "missing" was not admitted, so joy 3 has no Gesture left and uses Default.
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
    expect(candidates(0).map((row) => row.entry.id)).toEqual(["idle:sway"]);
    expect(candidates(10).map((row) => row.entry.id)).toEqual(["idle:sway"]);
    expect(candidates(20).map((row) => row.entry.id)).toEqual(["idle:wave"]);
    expect(candidates(20)[0]?.effectiveDurationSec).toBe(0.5);
    expect(candidates(30).map((row) => row.entry.id)).toEqual(["idle:sway"]);
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
