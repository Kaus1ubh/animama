import { describe, expect, it } from "vitest";

import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import {
  formatReactionClipCells,
  reactionClipCells,
  reactionClipMatchesFilters,
  type ReactionClipFilters,
} from "./reactionClipCatalog";

const open: ReactionClipFilters = {
  group: "all",
  emotion: "all",
  intensity: "all",
};

describe("debug Reaction catalog", () => {
  it("lists a live Reaction under every cell whose pool holds it", () => {
    const cells = reactionClipCells({
      joy: {
        "2": ["reaction:cheer"],
        "4": ["reaction:cheer", "reaction:grin"],
      },
      sadness: { "1": ["reaction:cheer"] },
      // Not a tracked emotion, so it names no cell.
      alarm: { "1": ["reaction:odd"] },
    });

    expect(cells.get("reaction:cheer")).toEqual([
      expect.objectContaining({ emotion: "joy", intensity: 2 }),
      expect.objectContaining({ emotion: "joy", intensity: 4 }),
      expect.objectContaining({ emotion: "sadness", intensity: 1 }),
    ]);
    expect(formatReactionClipCells(cells.get("reaction:cheer")!)).toBe(
      "joy 2, joy 4, sadness 1",
    );
    expect(cells.has("reaction:odd")).toBe(false);

    const cheer = cells.get("reaction:cheer")!;
    expect(reactionClipMatchesFilters(cheer, { ...open, intensity: "4" })).toBe(
      true,
    );
    expect(
      reactionClipMatchesFilters(cheer, { ...open, emotion: "sadness" }),
    ).toBe(true);
    // One cell must pass every filter: cheer is not in sadness 4.
    expect(
      reactionClipMatchesFilters(cheer, {
        ...open,
        emotion: "sadness",
        intensity: "4",
      }),
    ).toBe(false);
  });

  it("shows a Reaction in no pool only under All", () => {
    expect(reactionClipMatchesFilters([], open)).toBe(true);
    expect(reactionClipMatchesFilters([], { ...open, intensity: "1" })).toBe(
      false,
    );
    expect(formatReactionClipCells([])).toBe("-");
  });

  it("reads the built-in catalog's Included pools", () => {
    const cells = reactionClipCells(
      BUILT_IN_AVATAR_MOTION_CATALOG.listReactionPools(),
    );
    expect(cells.get("joy-1")).toEqual([
      expect.objectContaining({ emotion: "joy", intensity: 1 }),
    ]);
    for (const runtimeId of ["joy-4", "joy-4-b"])
      expect(cells.get(runtimeId)).toEqual([
        expect.objectContaining({ emotion: "joy", intensity: 4 }),
      ]);
  });
});
