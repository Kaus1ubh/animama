import { describe, expect, it } from "vitest";

import type { PyAnimaListItem } from "@/lib/content/catalogTypes";
import type { AnimaRuntimeCatalogSnapshot } from "@/lib/runtime-content/types";
import {
  poseCreatorModelPreviewTarget,
  poseCreatorModelSourceFromAnima,
  selectPoseCreatorPreviewAnima,
  shouldPersistLastActiveAnima,
} from "./poseCreatorPreview";

function anima(id: string): PyAnimaListItem {
  return {
    id,
    display_name: id,
    aggregate_revision: 1,
    identity_status: "ready",
    presentation: {
      anima_id: id,
      presentation_revision: `presentation:${id}`,
      display_name: id,
    },
  };
}

function runtime(): AnimaRuntimeCatalogSnapshot {
  return {
    schema_version: 1,
    effective_revision: "runtime-7",
    loadout_revision: 7,
    app_catalog_version: 1,
    avatar_model: {
      slot: "primary_model",
      runtime_id: "primary",
      kind: "avatar_model",
      display_name: "Equipped Model",
      description: null,
      config_schema_version: 1,
      config: {},
      content_revision: "model-3",
      source: {
        type: "public_url",
        url: "/vrm/AvatarSample_A_1_New.vrm",
      },
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
    warnings: [],
  };
}

describe("pose creator preview selection", () => {
  const animas = [anima("anima-a"), anima("anima-b")];

  it("uses a remembered owned Anima", () => {
    expect(selectPoseCreatorPreviewAnima(animas, "anima-b")).toMatchObject({
      anima: { id: "anima-b" },
      status: "remembered",
    });
  });

  it("falls back deterministically for missing and stale settings", () => {
    expect(selectPoseCreatorPreviewAnima(animas, null)).toMatchObject({
      anima: { id: "anima-a" },
      status: "fallback",
    });
    expect(selectPoseCreatorPreviewAnima(animas, "deleted")).toMatchObject({
      anima: { id: "anima-a" },
      status: "stale_fallback",
    });
    expect(selectPoseCreatorPreviewAnima([], "deleted")).toEqual({
      anima: null,
      status: "none",
    });
  });

  it("dedupes unchanged settings and rejects stale route IDs", () => {
    expect(
      shouldPersistLastActiveAnima({
        routeAnimaId: "anima-a",
        rememberedAnimaId: "anima-a",
        ownedAnimaIds: ["anima-a"],
      }),
    ).toBe(false);
    expect(
      shouldPersistLastActiveAnima({
        routeAnimaId: "anima-a",
        rememberedAnimaId: null,
        ownedAnimaIds: ["anima-a"],
      }),
    ).toBe(true);
    expect(
      shouldPersistLastActiveAnima({
        routeAnimaId: "deleted",
        rememberedAnimaId: null,
        ownedAnimaIds: ["anima-a"],
      }),
    ).toBe(false);
  });

  it("resolves the exact equipped model only for its immutable runtime", () => {
    const selectedRuntime = runtime();
    const source = poseCreatorModelSourceFromAnima("anima-a", selectedRuntime);
    expect(
      poseCreatorModelPreviewTarget({
        source,
        animaId: "anima-a",
        runtime: selectedRuntime,
      }),
    ).toMatchObject({
      sourceType: "resolved_entry",
      entry: { content_revision: "model-3" },
    });
    expect(
      poseCreatorModelPreviewTarget({
        source,
        animaId: "anima-b",
        runtime: selectedRuntime,
      }),
    ).toBeNull();
  });
});
