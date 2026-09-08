import { describe, expect, it } from "vitest";

import type { PyReaction } from "@/lib/content/catalogTypes";
import {
  buildReactionLoadoutGrid,
  groupReactionSelectorChoices,
} from "./reactionLoadoutGrid";

describe("Reaction loadout grid", () => {
  it("always produces the alphabetized 24-by-3 canonical matrix", () => {
    const rows = buildReactionLoadoutGrid([
      {
        emotion: "joy",
        intensity: 2,
        state: "custom",
        name: "Sparkle joy",
      },
    ]);
    expect(rows).toHaveLength(24);
    expect(rows.every((row) => row.cells.length === 3)).toBe(true);
    expect(rows.map((row) => row.emotion)).toEqual(
      [...rows.map((row) => row.emotion)].sort((left, right) =>
        left.localeCompare(right),
      ),
    );
    expect(rows.find((row) => row.emotion === "joy")?.cells[1]).toMatchObject({
      state: "custom",
      name: "Sparkle joy",
    });
    expect(rows.find((row) => row.emotion === "joy")?.cells[0].state).toBe(
      "empty",
    );
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
});
