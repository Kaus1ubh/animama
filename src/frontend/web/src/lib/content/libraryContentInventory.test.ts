import { describe, expect, it } from "vitest";
import { contentInventoryGroups } from "./libraryContentInventory";
import { normalizeContentLibrarySearch } from "./librarySearch";

describe("typed Library inventory", () => {
  it.each([
    "avatars",
    "gestures",
    "reactions",
    "poses",
    "particle",
    "avatar-effects",
    "scene",
    "sound",
  ])("filters All to %s without moving to another section", (type) => {
    const search = normalizeContentLibrarySearch({ type });
    expect(search.section).toBe("all");
    expect(contentInventoryGroups(search)).toEqual([type]);
  });

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
  it("drops the retired Idle Styles filter from old Library URLs", () => {
    const actions = normalizeContentLibrarySearch({
      section: "actions",
      action: "idle-styles",
    });
    expect(actions.action).toBe("all");
    expect(contentInventoryGroups(actions)).toEqual([
      "gestures",
      "reactions",
      "poses",
    ]);
    expect(normalizeContentLibrarySearch({ type: "idle-styles" }).type).toBe(
      "all",
    );
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
