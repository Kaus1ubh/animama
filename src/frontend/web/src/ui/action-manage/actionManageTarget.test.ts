import { describe, expect, it } from "vitest";
import type { PyAnimaLoadout } from "@animama/runtime-contracts/api-types";

import { catalogViewItem } from "@/lib/content/catalogTypes";
import {
  actionManageLoadoutSource,
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
    ).toEqual({ equipped: true, replacing: false });
  });

  it("shows a Gesture as not equipped before it is added", () => {
    expect(
      actionManageRowState(
        gestureTarget,
        loadout({ gestures: [gestureBinding("item-nod", "nod")] }),
      ),
    ).toEqual({ equipped: false, replacing: false });
  });

  it("warns when a Gesture would replace another with its semantic key", () => {
    expect(
      actionManageRowState(
        { ...gestureTarget, semanticKey: "wave" },
        loadout({ gestures: [gestureBinding("item-old-wave", "wave")] }),
      ),
    ).toEqual({ equipped: false, replacing: true });
  });

  it("keeps Reaction cell state by emotion and intensity", () => {
    const target: ManageActionTarget = {
      kind: "reaction",
      itemId: "item-cheer",
      name: "Cheer",
      description: "",
      emotion: "joy",
      intensity: 2,
    };
    const cell = (itemId: string) =>
      ({
        emotion: "joy",
        intensity: 2,
        state: "custom",
        source: { type: "catalog", catalog_item_id: itemId, source: "local" },
      }) as PyAnimaLoadout["reactions"][number];
    expect(
      actionManageRowState(
        target,
        loadout({ reactions: [cell("item-cheer")] }),
      ),
    ).toEqual({ equipped: true, replacing: false });
    expect(
      actionManageRowState(
        target,
        loadout({ reactions: [cell("item-other")] }),
      ),
    ).toEqual({ equipped: false, replacing: true });
  });
});
