import { describe, expect, it } from "vitest";
import { contentInventoryGroups } from "./libraryContentInventory";
import { normalizeContentLibrarySearch } from "./librarySearch";

describe("typed Library inventory", () => {
  it("includes Poses in Actions All and limits the Poses view to its family", () => {
    expect(
      contentInventoryGroups(
        normalizeContentLibrarySearch({ section: "actions" }),
      ),
    ).toEqual(["gestures", "reactions", "poses"]);
    expect(
      contentInventoryGroups(
        normalizeContentLibrarySearch({ section: "actions", action: "poses" }),
      ),
    ).toEqual(["poses"]);
  });
  it("groups real product types without a generic row", () => {
    expect(
      contentInventoryGroups(normalizeContentLibrarySearch({ section: "all" })),
    ).toEqual([
      "avatars",
      "gestures",
      "reactions",
      "poses",
      "particle",
      "avatar-effects",
      "scene",
      "sound",
    ]);
  });
});
