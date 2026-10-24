import { describe, expect, it } from "vitest";

import type { PyAnimaLoadout } from "@animama/runtime-contracts/api-types";
import type { PyGesture } from "@/lib/content/catalogTypes";
import {
  presentGestureCatalog,
  presentUnifiedGestureList,
} from "./animaLoadoutPresentation";

const includedSource = (id: string) => ({
  type: "catalog" as const,
  catalog_item_id: `included-${id}`,
  source: "included" as const,
  logical_key: `builtin:gesture:${id}`,
});

/** An Anima equipping one Included Gesture (Bow) and one Local Gesture (Sparkle wave). */
function loadout(): PyAnimaLoadout {
  return {
    anima_id: "anima-1",
    aggregate_revision: 2,
    revision: 2,
    starter_version: 1,
    warnings: [],
    reactions: [],
    idle: { default_pool: [], cells: [] },
    gestures: [
      {
        binding_id: "binding-bow",
        name: "Bow",
        semantic_key: "bow",
        implementation_kind: "vrma",
        source: includedSource("bow"),
      },
      {
        binding_id: "custom-1",
        name: "Sparkle wave",
        semantic_key: "sparkle-wave",
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

const builtinBow: PyGesture = {
  ...builtinWave,
  item_id: "included-bow",
  semantic_key: "bow",
  name: "Bow",
  source: includedSource("bow"),
};

const list = (
  current: PyAnimaLoadout,
  gestures: PyGesture[],
  options: Partial<Parameters<typeof presentUnifiedGestureList>[0]> = {},
) =>
  presentUnifiedGestureList({
    catalog: presentGestureCatalog(gestures, current.gestures),
    showIncluded: true,
    showLocal: true,
    updatesOnly: false,
    status: "all",
    motionType: "all",
    sort: "name-asc",
    query: "",
    ...options,
  });

describe("typed Anima loadout presentation", () => {
  it("lists Local Gestures first under custom-first, without release updates", () => {
    const highFive: PyGesture = {
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
    };
    const result = list(loadout(), [builtinBow, highFive, builtinWave], {
      sort: "custom-first",
    });
    expect(result.rows.map((row) => [row.source, row.name])).toEqual([
      ["local", "High Five"],
      ["local", "Sparkle wave"],
      ["included", "Bow"],
      ["included", "Wave"],
    ]);
    expect(result.updateAvailableCount).toBe(0);
    expect(result.rows.every((row) => !row.updateAvailable)).toBe(true);
  });

  it("lists the full Included catalog once alongside Local gestures and bindings", () => {
    const idle: PyGesture = {
      ...builtinWave,
      item_id: "included-idle",
      semantic_key: "idle",
      name: "Idle",
      source: includedSource("idle"),
    };
    const result = list(loadout(), [builtinBow, builtinWave, idle, idle]);

    expect(result.rows.map((row) => [row.name, row.equipped])).toEqual([
      ["Bow", true],
      ["Idle", false],
      ["Sparkle wave", true],
      ["Wave", false],
    ]);
    expect(result).toMatchObject({
      equippedCount: 2,
      totalCount: 4,
      includedCount: 3,
      localCount: 1,
    });
  });

  it("shows a removed Included Gesture as an ordinary unequipped row", () => {
    const current = loadout();
    current.gestures = current.gestures.filter(
      (row) => row.binding_id !== "binding-bow",
    );
    const result = list(current, [builtinBow]);
    expect(result.rows.find((row) => row.name === "Bow")).toEqual(
      expect.objectContaining({
        source: "included",
        equipped: false,
        gesture: builtinBow,
        binding: null,
      }),
    );
  });

  it.each([
    [true, false, ["Bow", "Wave"]],
    [false, true, ["Sparkle wave"]],
    [false, false, []],
  ] as const)(
    "filters by physical source with Included=%s and Local=%s",
    (showIncluded, showLocal, names) => {
      const result = list(loadout(), [builtinBow, builtinWave], {
        showIncluded,
        showLocal,
      });
      expect(result.rows.map((row) => row.name)).toEqual(names);
      expect(result).toMatchObject({ equippedCount: 2, totalCount: 3 });
    },
  );

  it("does not duplicate an equipped Included Gesture while its catalog entry is unavailable", () => {
    const current = loadout();
    current.gestures.push({
      binding_id: "explicit-wave",
      name: "Wave",
      semantic_key: "wave",
      implementation_kind: "vrma",
      source: includedSource("wave"),
    });
    const result = list(current, []);
    expect(result.rows.map((row) => row.name)).toEqual([
      "Bow",
      "Sparkle wave",
      "Wave",
    ]);
    expect(result.rows[2]).toMatchObject({
      equipped: true,
      source: "included",
    });
    expect(result.totalCount).toBe(3);
  });

  it.each([true, false])(
    "reconciles an Included binding whose key differs from its content id when catalog available=%s",
    (catalogAvailable) => {
      const current = loadout();
      const airQuotes: PyGesture = {
        ...builtinWave,
        item_id: "included-air-quotes",
        name: "Air Quotes",
        semantic_key: "air_quotes",
        source: includedSource("air-quotes"),
      };
      current.gestures = [
        {
          binding_id: "explicit-air-quotes",
          name: "Air Quotes",
          semantic_key: "air_quotes",
          implementation_kind: "vrma",
          source: includedSource("air-quotes"),
        },
      ];
      const result = list(current, catalogAvailable ? [airQuotes] : []);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        name: "Air Quotes",
        source: "included",
        equipped: true,
      });
      expect(result).toMatchObject({ totalCount: 1, equippedCount: 1 });
    },
  );

  it("keeps full inventory totals while combining search, type and status filters", () => {
    const result = list(loadout(), [builtinBow, builtinWave], {
      status: "unequipped",
      motionType: "vrma",
      sort: "name-desc",
      query: " wAvE ",
    });
    expect(result.rows.map((row) => row.name)).toEqual(["Wave"]);
    // Descriptions show only in a tooltip, so search never matches them.
    expect(
      list(loadout(), [builtinBow, builtinWave], { query: "friendly" }).rows,
    ).toEqual([]);
    expect(result).toMatchObject({
      equippedCount: 2,
      totalCount: 3,
      includedCount: 2,
      localCount: 1,
      motionTypeCounts: { vrma: 2, anima_clip: 1 },
    });
  });
});
