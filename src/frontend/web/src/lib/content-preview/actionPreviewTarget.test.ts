import { describe, expect, it } from "vitest";

import type { AnimaRuntimeCatalogSnapshot } from "@/lib/runtime-content/types";
import { creatorActionPreviewRuntime } from "./actionPreviewTarget";

const entry = (slot: "gesture" | "particle_vfx", runtimeId: string) => ({
  slot,
  runtime_id: runtimeId,
  kind:
    slot === "gesture"
      ? ("anima_pose_clip" as const)
      : ("particle_vfx" as const),
  display_name: runtimeId,
  description: runtimeId,
  config_schema_version: 1,
  config: {},
  content_revision: runtimeId,
  source: { type: "public_url" as const, url: `/${runtimeId}` },
});

describe("creatorActionPreviewRuntime", () => {
  it("mounts root-local aliases without removing opaque support IDs", () => {
    const root = {
      ...entry("gesture", "wave"),
      config: { runtime_reference_map: { sparkles: "opaque-particle" } },
    };
    const runtime = {
      schema_version: 1,
      effective_revision: "preview",
      loadout_revision: 0,
      app_catalog_version: 1,
      avatar_model: {
        ...entry("gesture", "avatar"),
        slot: "primary_model",
        kind: "avatar_model",
      },
      idle_animations: [],
      gestures: [root],
      poses: [],
      reactions: [],
      particle_vfx: [entry("particle_vfx", "opaque-particle")],
      avatar_vfx: [],
      scene_background_vfx: [],
      scene_focus_vfx: [],
      background_image: null,
      profile_image: null,
      sfx: [],
      bgm: [],
      warnings: [],
    } as AnimaRuntimeCatalogSnapshot;

    const prepared = creatorActionPreviewRuntime(runtime);
    expect(prepared.particle_vfx.map((value) => value.runtime_id)).toEqual([
      "opaque-particle",
      "sparkles",
    ]);
    expect(runtime.particle_vfx).toHaveLength(1);
  });
});
