import { describe, expect, it } from "vitest";

import type {
  AnimaRuntimeCatalogSnapshot,
  RuntimeCatalogEntry,
} from "@/lib/runtime-content/types";
import type { ContentPreviewTarget } from "./types";
import {
  prepareContentPreview,
  resolveContentPreviewEntry,
} from "./preparation";

function entry(runtimeId = "wave"): RuntimeCatalogEntry {
  return {
    slot: "gesture",
    runtime_id: runtimeId,
    kind: "animation",
    display_name: "Wave",
    description: null,
    config_schema_version: 1,
    config: { speed: 1.25 },
    content_revision: `revision:${runtimeId}`,
    source: {
      type: "authorized_files",
      files: [],
    },
  };
}

function runtime(): AnimaRuntimeCatalogSnapshot {
  return {
    schema_version: 1,
    effective_revision: "runtime-1",
    loadout_revision: 1,
    app_catalog_version: 1,
    avatar_model: {
      ...entry("avatar"),
      slot: "primary_model",
      kind: "avatar_model",
    },
    idle_animations: [],
    gestures: [],
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

describe("Asset preview preparation", () => {
  it("uses an exact resolved entry and preserves draft runtime configuration", () => {
    const currentRuntime = runtime();
    const selected = entry();
    const target: ContentPreviewTarget = {
      key: "anima:gesture:wave:draft",
      sourceType: "resolved_entry",
      entry: selected,
      kind: "animation",
      displayName: "Wave",
      versionLabel: "Pinned version",
      slot: "gesture",
      runtimeId: "wave",
      configSchemaVersion: 1,
      config: { speed: 1.25 },
      animaContext: { animaId: "anima-1", runtime: currentRuntime },
    };
    const resolved = resolveContentPreviewEntry(target);
    expect(resolved).toBe(selected);
    const prepared = prepareContentPreview(target, selected);
    expect(prepared.runtime.gestures).toEqual([selected]);
    expect(prepared.runtime).not.toBe(currentRuntime);
    expect(currentRuntime.gestures).toEqual([]);
  });

  it("uses a dependency-complete action runtime without rebuilding it", () => {
    const currentRuntime = runtime();
    const selected = entry();
    const target: ContentPreviewTarget = {
      key: "action:gesture:wave:release-2",
      sourceType: "resolved_action",
      entry: selected,
      runtime: currentRuntime,
      kind: "animation",
      displayName: "Wave",
      versionLabel: "Version 2",
      slot: "gesture",
      runtimeId: "wave",
      configSchemaVersion: 1,
      config: {},
    };
    expect(resolveContentPreviewEntry(target)).toBe(selected);
    expect(prepareContentPreview(target, selected).runtime).toBe(
      currentRuntime,
    );
  });

  it("mounts a complete action closure over the selected Anima", () => {
    const selectedAnimaRuntime = runtime();
    selectedAnimaRuntime.avatar_model!.content_revision = "avatar:caitlyn";
    selectedAnimaRuntime.gestures = [entry("equipped-wave")];
    const selected = entry("shy-finger-poke");
    const sound: RuntimeCatalogEntry = {
      ...entry("sparkle-sound"),
      slot: "sfx",
      kind: "audio",
    };
    const closure = runtime();
    closure.effective_revision = "action-closure-1";
    closure.gestures = [selected];
    closure.sfx = [sound];
    const target: ContentPreviewTarget = {
      key: "action:gesture:shy-finger-poke:release-2",
      sourceType: "resolved_action",
      entry: selected,
      runtime: closure,
      kind: "anima_pose_clip",
      displayName: "Shy Finger Poke",
      versionLabel: "Version 2",
      slot: "gesture",
      runtimeId: "shy-finger-poke",
      configSchemaVersion: 1,
      config: {},
      animaContext: {
        animaId: "anima-caitlyn",
        runtime: selectedAnimaRuntime,
      },
    };

    const prepared = prepareContentPreview(target, selected);

    expect(prepared.runtime.avatar_model?.content_revision).toBe(
      "anima:anima-caitlyn:avatar:caitlyn",
    );
    expect(prepared.runtime.gestures).toEqual([
      selectedAnimaRuntime.gestures[0],
      selected,
    ]);
    expect(prepared.runtime.sfx).toEqual([sound]);
    expect(prepared.runtime.effective_revision).toContain("action-closure-1");
    expect(selectedAnimaRuntime.sfx).toEqual([]);
    expect(closure.avatar_model?.content_revision).toBe("revision:avatar");
  });
});
