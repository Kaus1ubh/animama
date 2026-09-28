import { describe, expect, it } from "vitest";

import type {
  AnimaRuntimeCatalogSnapshot,
  RuntimeCatalogEntry,
} from "@/lib/runtime-content/types";
import type { ContentPreviewTarget } from "./types";
import {
  INITIAL_ANIMA_STAGE_PREVIEW_STATE,
  isAnimaStagePreviewTarget,
  reduceAnimaStagePreview,
  selectAnimaStageAvatarEntry,
} from "./managementPreview";
import { prepareContentPreview } from "./preparation";

function entry(
  slot: RuntimeCatalogEntry["slot"],
  kind: RuntimeCatalogEntry["kind"],
  runtimeId: string,
): RuntimeCatalogEntry {
  return {
    slot,
    runtime_id: runtimeId,
    kind,
    display_name: runtimeId,
    description: null,
    config_schema_version: 1,
    config: {},
    content_revision: `revision:${runtimeId}`,
    source: {
      type: "public_url",
      url: `/fixtures/${kind}/${runtimeId}`,
    },
  };
}

function runtime(): AnimaRuntimeCatalogSnapshot {
  return {
    schema_version: 1,
    effective_revision: "runtime-1",
    loadout_revision: 1,
    app_catalog_version: 1,
    avatar_model: entry("primary_model", "avatar_model", "avatar"),
    idle_animations: [entry("idle_animation", "animation", "idle")],
    gestures: [],
    poses: [],
    reactions: [entry("reaction", "anima_pose_clip", "reaction")],
    particle_vfx: [],
    avatar_vfx: [],
    scene_background_vfx: [],
    scene_focus_vfx: [],
    background_image: null,
    profile_image: null,
    sfx: [],
    warnings: [],
  };
}

function boundTarget(
  currentRuntime: AnimaRuntimeCatalogSnapshot,
  selectedEntry = currentRuntime.idle_animations[0],
): ContentPreviewTarget {
  return {
    key: `bound:${selectedEntry.runtime_id}`,
    sourceType: "resolved_entry",
    entry: selectedEntry,
    kind: selectedEntry.kind as "animation" | "anima_pose_clip",
    displayName: selectedEntry.display_name,
    versionLabel: "Pinned version",
    slot: selectedEntry.slot,
    runtimeId: selectedEntry.runtime_id,
    configSchemaVersion: selectedEntry.config_schema_version,
    config: { ...selectedEntry.config },
    animaContext: { animaId: "anima-1", runtime: currentRuntime },
  };
}

describe("Anima management-stage Asset previews", () => {
  it("accepts every exact target carrying Anima runtime context", () => {
    const currentRuntime = runtime();
    expect(isAnimaStagePreviewTarget(boundTarget(currentRuntime))).toBe(true);
    expect(
      isAnimaStagePreviewTarget({
        ...boundTarget(currentRuntime),
        sourceType: "resolved_action",
        entry: currentRuntime.idle_animations[0],
        runtime: currentRuntime,
      }),
    ).toBe(true);
    expect(
      isAnimaStagePreviewTarget({
        ...boundTarget(currentRuntime),
        animaContext: undefined,
      }),
    ).toBe(false);
  });

  it("clones the catalog without mutating authoritative query data", () => {
    const currentRuntime = runtime();
    const before = JSON.stringify(currentRuntime);
    const target = boundTarget(currentRuntime);
    if (target.sourceType !== "resolved_entry") throw new Error("fixture");
    const prepared = prepareContentPreview(target, target.entry);
    expect(prepared.runtime).not.toBe(currentRuntime);
    expect(prepared.runtime.idle_animations).not.toBe(
      currentRuntime.idle_animations,
    );
    expect(JSON.stringify(currentRuntime)).toBe(before);
  });

  it("retains a target for Replay after completion and clears it on Stop", () => {
    const target = boundTarget(runtime());
    if (target.sourceType !== "resolved_entry") throw new Error("fixture");
    const prepared = prepareContentPreview(target, target.entry);
    const selected = reduceAnimaStagePreview(
      INITIAL_ANIMA_STAGE_PREVIEW_STATE,
      {
        type: "select",
        target,
      },
    );
    const opened = reduceAnimaStagePreview(selected, {
      type: "prepared",
      prepared,
      autoplay: true,
    });
    const ready = reduceAnimaStagePreview(opened, {
      type: "status",
      status: "ready",
    });
    const replayed = reduceAnimaStagePreview(ready, { type: "replay" });
    expect(ready.prepared).toBe(prepared);
    expect(replayed.playRequest).toBe(opened.playRequest + 1);
    expect(reduceAnimaStagePreview(replayed, { type: "stop" })).toMatchObject({
      prepared: null,
      target: null,
      status: "idle",
      loop: false,
    });
  });

  it("reuses the saved model, restores after failure, and retries on Replay", () => {
    const currentRuntime = runtime();
    const target = boundTarget(currentRuntime, {
      ...currentRuntime.avatar_model!,
      content_revision: "revision:avatar-v2",
      source: {
        type: "authorized_files",
        files: [],
      },
    });
    if (target.sourceType !== "resolved_entry") throw new Error("fixture");
    const prepared = prepareContentPreview(target, target.entry);
    const selected = selectAnimaStageAvatarEntry({
      saved: currentRuntime.avatar_model,
      prepared,
      playRequest: 4,
    });
    expect(selected).toEqual({ entry: target.entry, temporary: true });
    expect(
      selectAnimaStageAvatarEntry({
        saved: currentRuntime.avatar_model,
        prepared,
        failed: { key: target.entry.content_revision, playRequest: 4 },
        playRequest: 4,
      }),
    ).toEqual({ entry: currentRuntime.avatar_model, temporary: false });
    expect(
      selectAnimaStageAvatarEntry({
        saved: currentRuntime.avatar_model,
        prepared,
        failed: { key: target.entry.content_revision, playRequest: 4 },
        playRequest: 5,
      }),
    ).toEqual({ entry: target.entry, temporary: true });
  });
});
