import { describe, expect, it } from "vitest";
import type { PyCatalogViewItem } from "@/lib/content/catalogTypes";
import { creatorEffectEditTarget, creatorLoadItems } from "./CreatorLoadPicker";

const effect = (
  overrides: Partial<PyCatalogViewItem> = {},
): PyCatalogViewItem => ({
  item_id: "editable-local",
  name: "Sparkle",
  kind: "avatar_effect",
  origin: "owned",
  editable: true,
  state: "ready",
  source: {
    type: "catalog",
    catalog_item_id: "editable-local",
    logical_key: "sparkle",
    source: "local",
  },
  description: null,
  created_at: null,
  updated_at: null,
  ...overrides,
});

describe("FX creator Load eligibility", () => {
  it("only offers ready editable local items for the selected editor", () => {
    const local = effect();
    const items = [
      local,
      effect({ item_id: "starter", origin: "builtin" }),
      effect({ item_id: "locked", editable: false }),
      effect({ item_id: "broken", state: "invalid" }),
      effect({ item_id: "no-source", source: null }),
      effect({ item_id: "wrong-editor", kind: "scene_effect" }),
    ];
    expect(creatorLoadItems(items, "avatar_effect")).toEqual([local]);
  });
});

describe("FX editor navigation", () => {
  it.each([
    [
      "particle_effect",
      "/particle-effects/$particleEffectId/edit",
      "particleEffectId",
    ],
    ["avatar_effect", "/avatar-effects/$avatarEffectId/edit", "avatarEffectId"],
    ["scene_effect", "/scene-effects/$sceneEffectId/edit", "sceneEffectId"],
  ] as const)("opens %s in its typed editor", (kind, to, parameter) => {
    expect(creatorEffectEditTarget(kind, "local-id")).toEqual({
      to,
      params: { [parameter]: "local-id" },
    });
  });
});
