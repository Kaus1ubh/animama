import { describe, expect, it } from "vitest";

import type { PyIdleMember } from "@animama/runtime-contracts/api-types";
import type { PyGesture } from "@/lib/content/catalogTypes";
import {
  buildIdleLoadoutGrid,
  idleAddIntent,
  idleGestureChoices,
} from "./idleLoadoutGrid";

const member = (itemId: string): PyIdleMember => ({
  binding_id: `binding-${itemId}`,
  item_id: itemId,
  name: itemId,
  available: true,
});

describe("Idle loadout grid", () => {
  it("puts Default first and orders emotions alphabetically with three intensities", () => {
    const grid = buildIdleLoadoutGrid({
      default_pool: [member("sway")],
      cells: [
        { emotion: "joy", intensity: 2, gestures: [member("wave")] },
        { emotion: "anger", intensity: 1, gestures: [] },
        { emotion: "joy", intensity: 1, gestures: [] },
      ],
    });
    expect(grid.defaultCell).toMatchObject({
      key: "default",
      emotion: null,
      intensity: null,
    });
    expect(grid.defaultCell.gestures.map((value) => value.item_id)).toEqual([
      "sway",
    ]);
    expect(grid.rows.map((row) => row.emotion)).toEqual(["anger", "joy"]);
    const joy = grid.rows[1]!;
    expect(joy.cells.map((cell) => cell.key)).toEqual([
      "joy-1",
      "joy-2",
      "joy-3",
    ]);
    expect(joy.gestureCount).toBe(1);
  });

  it("offers ready Gestures not already in the cell, Local before Included", () => {
    const gesture = (itemId: string, origin: "owned" | "builtin") =>
      ({
        item_id: itemId,
        name: itemId,
        origin,
        state: "ready",
        source: { type: "catalog", catalog_item_id: itemId },
      }) as PyGesture;
    const choices = idleGestureChoices(
      [
        gesture("wave", "builtin"),
        gesture("mine", "owned"),
        gesture("sway", "builtin"),
        { ...gesture("broken", "owned"), state: "invalid" } as PyGesture,
      ],
      {
        key: "default",
        emotion: null,
        intensity: null,
        gestures: [member("sway")],
        inherited: [],
      },
    );
    expect(choices.local.map((value) => value.item_id)).toEqual(["mine"]);
    expect(choices.included.map((value) => value.item_id)).toEqual(["wave"]);
  });

  it("lets each intensity inherit lower ones once, without repeating its own", () => {
    const grid = buildIdleLoadoutGrid({
      default_pool: [member("sway")],
      cells: [
        { emotion: "joy", intensity: 1, gestures: [member("hop")] },
        {
          emotion: "joy",
          intensity: 2,
          gestures: [member("wave"), member("hop")],
        },
        { emotion: "joy", intensity: 3, gestures: [member("wave")] },
      ],
    });
    const [mild, moderate, strong] = grid.rows[0]!.cells;
    const inherited = (cell: typeof mild) =>
      cell.inherited.map(({ member, intensity }) => [
        member.item_id,
        intensity,
      ]);
    expect(inherited(mild)).toEqual([]);
    // Moderate holds hop itself, so it is not listed as inherited there.
    expect(inherited(moderate)).toEqual([]);
    expect(inherited(strong)).toEqual([["hop", 1]]);
    expect(grid.defaultCell.inherited).toEqual([]);

    // A cell offers neither its own Gestures nor the ones it inherits.
    const gesture = (itemId: string) =>
      ({
        item_id: itemId,
        name: itemId,
        origin: "builtin",
        state: "ready",
        source: { type: "catalog", catalog_item_id: itemId },
      }) as PyGesture;
    const choices = idleGestureChoices(
      ["hop", "wave", "sway", "nod"].map(gesture),
      strong,
    );
    expect(choices.included.map((value) => value.item_id)).toEqual([
      "sway",
      "nod",
    ]);
  });

  it("adds to Default without a cell and to a cell with its emotion and intensity", () => {
    const source = {
      type: "catalog" as const,
      catalog_item_id: "wave",
      source: "local" as const,
    };
    const grid = buildIdleLoadoutGrid({
      default_pool: [],
      cells: [{ emotion: "joy", intensity: 2, gestures: [] }],
    });
    expect(idleAddIntent(grid.defaultCell, source)).toEqual({
      operation: "add",
      source,
    });
    expect(idleAddIntent(grid.rows[0]!.cells[1], source)).toEqual({
      operation: "add",
      emotion: "joy",
      intensity: 2,
      source,
    });
  });
});
