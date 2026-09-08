import { describe, expect, it } from "vitest";
import { contentInventoryGroups } from "./libraryContentInventory";
import { normalizeContentLibrarySearch } from "./librarySearch";

describe("typed Library inventory", () => {
  it("groups real product types without a generic row", () => {
    expect(
      contentInventoryGroups(normalizeContentLibrarySearch({ section: "all" })),
    ).toEqual([
      "avatars",
      "gestures",
      "reactions",
      "particle",
      "avatar-effects",
      "scene",
      "sound",
    ]);
  });
});
