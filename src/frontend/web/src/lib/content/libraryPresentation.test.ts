import { describe, expect, it } from "vitest";
import type { LibraryProductCard } from "./libraryPresentation";
import {
  avatarLibraryDescription,
  effectLibraryCard,
  filterAndSortLibraryGestures,
  libraryProductActionPolicy,
  libraryProductMetadata,
  libraryRowPresentation,
  actionLibraryCard,
} from "./libraryPresentation";

function card(
  family: LibraryProductCard["family"],
  origin: LibraryProductCard["origin"] = "Built-in",
): LibraryProductCard {
  return {
    key: `${family}:one`,
    itemId: `${family}-one`,
    family,
    name: "Example",
    description: "Example description",
    origin,
    sourceLabel: "Included",
    updateAvailable: family === "gesture",
    equippedCount: family === "gesture" ? 2 : 0,
    includedCount: family === "gesture" ? 3 : 0,
    source: {
      type: "builtin",
      content_id: `builtin:${family}:one`,
      version: 2,
    },
  };
}

describe("Library product presentation", () => {
  it("never needs a technical file kind to present a Gesture", () => {
    const card = actionLibraryCard("gesture", {
      item_id: "gesture-1",
      name: "Sparkle Wave",
      description: "A bright greeting",
      origin: "builtin",
      source: {
        type: "builtin",
        content_id: "builtin:gesture:wave",
        version: 1,
      },
      state: "ready",
      semantic_key: "sparkle_wave",
      update_available: false,
      created_at: null,
      updated_at: null,
    });
    expect(card).toMatchObject({
      family: "gesture",
      name: "Sparkle Wave",
      origin: "Built-in",
    });
    expect(card).not.toHaveProperty("kind");
  });

  it.each(["gesture", "reaction"] as const)(
    "keeps %s Preview and Add/Manage domain actions",
    (family) => {
      expect(libraryProductActionPolicy(card(family))).toEqual({
        preview: true,
        manage: true,
        edit: false,
        useInGesture: false,
        useInReaction: false,
      });
    },
  );

  it.each(["particle", "avatar-effect", "scene", "sound"] as const)(
    "keeps %s reusable component actions",
    (family) => {
      expect(libraryProductActionPolicy(card(family))).toMatchObject({
        preview: true,
        manage: false,
        useInGesture: true,
        useInReaction: true,
      });
    },
  );

  it("offers Edit for every owned ready product with a typed editor", () => {
    expect(libraryProductActionPolicy(card("gesture", "Mine")).edit).toBe(true);
    expect(libraryProductActionPolicy(card("particle", "Mine")).edit).toBe(
      true,
    );
    expect(libraryProductActionPolicy(card("sound", "Mine")).edit).toBe(true);
    expect(libraryProductActionPolicy(card("avatar-effect", "Mine")).edit).toBe(
      true,
    );
    expect(libraryProductActionPolicy(card("scene", "Mine")).edit).toBe(true);
    expect(
      libraryProductActionPolicy({ ...card("gesture", "Mine"), source: null })
        .edit,
    ).toBe(false);
  });

  it("labels a ready owned Effect as Local", () => {
    const result = effectLibraryCard("avatar-effect", {
      item_id: "avatar-effect-1",
      name: "Star Eyes",
      description: "Stars over both eyes",
      origin: "owned",
      source: {
        type: "catalog",
        catalog_item_id: "avatar-effect-1",
        logical_key: "local:avatar-effect:star-eyes",
      },
      state: "ready",
      created_at: null,
      updated_at: null,
    });

    expect(result.sourceLabel).toBe("Local");
  });

  it("surfaces equipped and update metadata in the compact scan line", () => {
    const gesture = card("gesture");
    expect(libraryProductMetadata(gesture)).toEqual([
      "Included",
      "Built-in",
      "Added to 2 Animas",
      "Update available",
    ]);
    expect(libraryRowPresentation(gesture)).toMatchObject({
      family: "gesture",
      includedCount: 3,
      updateAvailable: true,
      equippedCount: 2,
    });
  });

  it("filters and sorts Gestures with the Anima Loadout choices", () => {
    const custom = {
      ...card("gesture", "Mine"),
      key: "gesture:custom",
      name: "Wave",
      updateAvailable: false,
      equippedCount: 0,
    };
    const starter = {
      ...card("gesture", "Built-in"),
      key: "gesture:starter",
      name: "Bow",
    };

    expect(
      filterAndSortLibraryGestures([starter, custom], {
        gestureUpdatesOnly: false,
        gestureStatus: "all",
        gestureSort: "custom-first",
      }).map((gesture) => gesture.key),
    ).toEqual(["gesture:custom", "gesture:starter"]);
    expect(
      filterAndSortLibraryGestures([starter, custom], {
        gestureUpdatesOnly: false,
        gestureStatus: "unequipped",
        gestureSort: "name-asc",
      }).map((gesture) => gesture.name),
    ).toEqual(["Wave"]);
    expect(
      filterAndSortLibraryGestures([starter, custom], {
        gestureUpdatesOnly: true,
        gestureStatus: "equipped",
        gestureSort: "name-desc",
      }).map((gesture) => gesture.name),
    ).toEqual(["Bow"]);
  });

  it("turns Avatar identity markdown into a concise row description", () => {
    expect(
      avatarLibraryDescription(
        "# Annie\n\n## Appearance\nAnnie has short dark hair.\n\n## Personality",
      ),
    ).toBe("Annie has short dark hair.");
    expect(avatarLibraryDescription("# Empty")).toBe("VRM Avatar");
  });
});
