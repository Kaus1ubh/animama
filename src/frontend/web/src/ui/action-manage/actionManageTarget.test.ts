import { describe, expect, it } from "vitest";
import type { PyAnimaLoadout } from "@animama/runtime-contracts/api-types";

import { catalogViewItem } from "@/lib/content/catalogTypes";
import {
  actionManageLoadoutSource,
  actionManageReactionCell,
  actionManageReactionMember,
  actionManageRowState,
} from "./actionManageTarget";
import type { ManageActionTarget } from "./ActionManageDialog";

const gestureTarget: ManageActionTarget = {
  kind: "gesture",
  itemId: "item-wave",
  name: "Wave",
  description: "",
};

function loadout(overrides: Partial<PyAnimaLoadout>): PyAnimaLoadout {
  return {
    gestures: [],
    reactions: [],
    ...overrides,
  } as unknown as PyAnimaLoadout;
}

function gestureBinding(itemId: string, semanticKey: string) {
  return {
    binding_id: `binding-${itemId}`,
    name: semanticKey,
    semantic_key: semanticKey,
    origin: "custom",
    implementation_kind: "anima_clip",
    source: { type: "catalog", catalog_item_id: itemId, source: "local" },
  } as PyAnimaLoadout["gestures"][number];
}

describe("action manage target", () => {
  it("equips the source a creator save returns", () => {
    // Save & Equip passes the saved catalog view item's source unchanged.
    const saved = catalogViewItem({
      item_id: "item-wave",
      logical_key: "local:gesture:wave",
      source: "local",
    } as Parameters<typeof catalogViewItem>[0]);
    expect(
      actionManageLoadoutSource({ ...gestureTarget, source: saved.source }),
    ).toEqual({
      type: "catalog",
      catalog_item_id: "item-wave",
      logical_key: "local:gesture:wave",
      source: "local",
    });
  });

  it("refuses a source without its library partition", () => {
    expect(
      actionManageLoadoutSource({
        ...gestureTarget,
        source: { type: "catalog", catalog_item_id: "item-wave" },
      }),
    ).toBeNull();
  });

  it("shows a Gesture as equipped by catalog item, without a semantic key", () => {
    expect(
      actionManageRowState(
        gestureTarget,
        loadout({ gestures: [gestureBinding("item-wave", "wave")] }),
      ),
    ).toEqual({ equipped: true, replacing: false, full: false });
  });

  it("shows a Gesture as not equipped before it is added", () => {
    expect(
      actionManageRowState(
        gestureTarget,
        loadout({ gestures: [gestureBinding("item-nod", "nod")] }),
      ),
    ).toEqual({ equipped: false, replacing: false, full: false });
  });

  it("warns when a Gesture would replace another with its semantic key", () => {
    expect(
      actionManageRowState(
        { ...gestureTarget, semanticKey: "wave" },
        loadout({ gestures: [gestureBinding("item-old-wave", "wave")] }),
      ),
    ).toEqual({ equipped: false, replacing: true, full: false });
  });

  describe("Reaction cells", () => {
    const target: ManageActionTarget = {
      kind: "reaction",
      itemId: "item-cheer",
      name: "Cheer",
      description: "",
      emotion: "joy",
      intensity: 4,
    };
    const cell = (
      emotion: string,
      intensity: 1 | 2 | 3 | 4,
      ...itemIds: string[]
    ) =>
      ({
        emotion,
        intensity,
        state: "custom",
        members: itemIds.map((itemId) => ({
          binding_id: `binding-${itemId}`,
          item_id: itemId,
          name: itemId,
          available: true,
          origin: "custom",
        })),
      }) as PyAnimaLoadout["reactions"][number];

    it("defaults to the Reaction's suggested cell", () => {
      expect(actionManageReactionCell(target)).toEqual({
        emotion: "joy",
        intensity: 4,
      });
      expect(
        actionManageReactionCell({ emotion: "grief", intensity: 2 }),
      ).toEqual({ emotion: "grief", intensity: 2 });
    });

    it("uses Joy, Mild without a usable suggestion", () => {
      expect(actionManageReactionCell({})).toEqual({
        emotion: "joy",
        intensity: 1,
      });
      // An intensity alone, or outside 1–4, is not a suggested cell.
      expect(actionManageReactionCell({ intensity: 3 })).toEqual({
        emotion: "joy",
        intensity: 1,
      });
      expect(actionManageReactionCell({ emotion: "anger" })).toEqual({
        emotion: "anger",
        intensity: 1,
      });
      expect(
        actionManageReactionCell({ emotion: "anger", intensity: 7 }),
      ).toEqual({ emotion: "anger", intensity: 1 });
      // An emotion the cells do not track cannot be a cell.
      expect(
        actionManageReactionCell({ emotion: "neutral", intensity: 2 }),
      ).toEqual({ emotion: "joy", intensity: 1 });
    });

    it("reports membership of the chosen cell, not of other cells", () => {
      const reactions = [
        cell("joy", 4, "item-other", "item-cheer"),
        cell("joy", 1, "item-other"),
      ];
      expect(actionManageRowState(target, loadout({ reactions }))).toEqual({
        equipped: true,
        replacing: false,
        full: false,
      });
      expect(
        actionManageRowState(target, loadout({ reactions }), {
          emotion: "joy",
          intensity: 1,
        }),
      ).toEqual({ equipped: false, replacing: false, full: false });
      expect(
        actionManageReactionMember(target, loadout({ reactions }), {
          emotion: "joy",
          intensity: 4,
        })?.binding_id,
      ).toBe("binding-item-cheer");
      expect(
        actionManageReactionMember(target, loadout({ reactions }), {
          emotion: "joy",
          intensity: 1,
        }),
      ).toBeNull();
    });

    it("reports a full chosen cell, which still lets a member be removed", () => {
      const full = cell("joy", 4, "a", "b", "c", "d");
      expect(
        actionManageRowState(target, loadout({ reactions: [full] })),
      ).toEqual({ equipped: false, replacing: false, full: true });
      const fullWithCheer = cell("joy", 4, "a", "b", "c", "item-cheer");
      expect(
        actionManageRowState(target, loadout({ reactions: [fullWithCheer] })),
      ).toEqual({ equipped: true, replacing: false, full: true });
      // A missing cell is an empty pool.
      expect(actionManageRowState(target, loadout({}))).toEqual({
        equipped: false,
        replacing: false,
        full: false,
      });
    });
  });
});
