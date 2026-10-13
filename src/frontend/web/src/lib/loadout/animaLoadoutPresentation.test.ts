import { describe, expect, it } from "vitest";

import type { PyAnimaLoadout } from "@animama/runtime-contracts/api-types";
import type { PyGesture } from "@/lib/content/catalogTypes";
import {
  presentCustomGestureCatalog,
  presentGestureLoadout,
  presentUnifiedGestureList,
} from "./animaLoadoutPresentation";

const includedSource = (id: string) => ({
  type: "catalog" as const,
  catalog_item_id: `included-${id}`,
  source: "included" as const,
  logical_key: `builtin:gesture:${id}`,
});

function loadout(): PyAnimaLoadout {
  return {
    anima_id: "anima-1",
    aggregate_revision: 2,
    revision: 2,
    starter_version: 1,
    disabled_starter_gestures: ["wave"],
    starter_gesture_implementation_kinds: { wave: "vrma" },
    warnings: [],
    reactions: [],
    idle_style: { state: "starter" },
    gestures: [
      {
        binding_id: "starter:bow",
        name: "Bow",
        semantic_key: "bow",
        origin: "starter",
        implementation_kind: "vrma",
        source: includedSource("bow"),
      },
      {
        binding_id: "custom-1",
        name: "Sparkle wave",
        semantic_key: "sparkle-wave",
        origin: "custom",
        implementation_kind: "anima_clip",
        source: {
          type: "catalog",
          catalog_item_id: "gesture-sparkle",
          source: "local",
          logical_key: "local:gesture:sparkle-wave",
        },
      },
    ],
  };
}

const builtinWave: PyGesture = {
  item_id: "starter-wave",
  name: "Wave",
  description: "A friendly greeting",
  origin: "builtin",
  source: {
    type: "catalog",
    catalog_item_id: "starter-wave",
    source: "included",
    logical_key: "builtin:gesture:wave",
  },
  state: "ready",
  created_at: null,
  updated_at: null,
  semantic_key: "wave",
  implementation_kind: "vrma",
};

describe("typed Anima loadout presentation", () => {
  it("separates Included defaults from explicit Local Gesture roots", () => {
    const result = presentGestureLoadout(loadout(), [builtinWave]);
    expect(result.starter).toHaveLength(1);
    expect(result.disabledStarter).toHaveLength(1);
    expect(result.custom.map((row) => row.name)).toEqual(["Sparkle wave"]);
    expect(result.disabledStarter[0]?.gesture?.source).toEqual(
      builtinWave.source,
    );
  });

  it("builds a searchable custom-first list without release updates", () => {
    const presentation = presentGestureLoadout(loadout(), [builtinWave]);
    const catalog = presentCustomGestureCatalog(
      [
        {
          item_id: "gesture-high-five",
          name: "High Five",
          description: "Friendly greeting",
          origin: "owned",
          source: {
            type: "catalog",
            catalog_item_id: "gesture-high-five",
            source: "local",
            logical_key: "local:gesture:high-five",
          },
          state: "ready",
          created_at: null,
          updated_at: null,
          semantic_key: "high-five",
          implementation_kind: "vrma",
        },
      ],
      presentation.custom,
    );

    const result = presentUnifiedGestureList({
      presentation,
      catalog,
      showStarters: true,
      updatesOnly: false,
      status: "all",
      motionType: "all",
      sort: "custom-first",
      query: "",
    });
    expect(result.rows.map((row) => [row.kind, row.name])).toEqual([
      ["custom", "High Five"],
      ["custom", "Sparkle wave"],
      ["starter", "Bow"],
      ["starter", "Wave"],
    ]);
    expect(result.updateAvailableCount).toBe(0);
    expect(result.rows.every((row) => !row.updateAvailable)).toBe(true);
  });
});
