import { describe, expect, it } from "vitest";

import type { PyReactionMember } from "@animama/runtime-contracts/api-types";
import type { PyReaction } from "@/lib/content/catalogTypes";
import {
  buildReactionLoadoutGrid,
  groupReactionSelectorChoices,
  reactionAddIntent,
  reactionCellFull,
} from "./reactionLoadoutGrid";

function member(itemId: string): PyReactionMember {
  return {
    binding_id: `binding-${itemId}`,
    item_id: itemId,
    name: itemId,
    available: true,
    origin: "custom",
  };
}

describe("Reaction loadout grid", () => {
  it("always produces the alphabetized 24-by-4 matrix with member counts", () => {
    const rows = buildReactionLoadoutGrid([
      {
        emotion: "joy",
        intensity: 4,
        state: "custom",
        members: [member("cheer"), member("grin")],
      },
    ]);
    expect(rows).toHaveLength(24);
    expect(rows.every((row) => row.cells.length === 4)).toBe(true);
    expect(rows.map((row) => row.emotion)).toEqual(
      [...rows.map((row) => row.emotion)].sort((left, right) =>
        left.localeCompare(right),
      ),
    );
    const joy = rows.find((row) => row.emotion === "joy")!;
    expect(joy.cells.map((cell) => cell.intensity)).toEqual([1, 2, 3, 4]);
    expect(joy.cells[3]).toMatchObject({ state: "custom" });
    expect(joy.cells[0]).toEqual({
      emotion: "joy",
      intensity: 1,
      state: "empty",
      members: [],
    });
    expect(joy.reactionCount).toBe(2);
  });

  it("offers every Reaction regardless of the target emotion or intensity", () => {
    const reactions = [
      {
        item_id: "local-joy-3",
        origin: "owned",
        emotion: "joy",
        intensity: 3,
      },
      {
        item_id: "included-sadness-1",
        origin: "builtin",
        emotion: "sadness",
        intensity: 1,
      },
    ] as PyReaction[];

    const groups = groupReactionSelectorChoices(reactions);

    expect(groups.local).toEqual([reactions[0]]);
    expect(groups.included).toEqual([reactions[1]]);
  });

  it("adds to a cell until it holds four Reactions", () => {
    const cell = {
      emotion: "joy",
      intensity: 2 as const,
      state: "custom" as const,
      members: ["a", "b", "c"].map(member),
    };
    expect(reactionCellFull(cell)).toBe(false);
    expect(
      reactionCellFull({ ...cell, members: [...cell.members, member("d")] }),
    ).toBe(true);
    expect(
      reactionAddIntent(cell, {
        type: "catalog",
        catalog_item_id: "cheer",
        source: "local",
      }),
    ).toEqual({
      operation: "add",
      emotion: "joy",
      intensity: 2,
      source: { type: "catalog", catalog_item_id: "cheer", source: "local" },
    });
  });
});
