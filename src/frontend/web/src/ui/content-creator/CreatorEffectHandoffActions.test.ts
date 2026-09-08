import { describe, expect, it } from "vitest";

import { effectCreatorHandoffSearch } from "./CreatorEffectHandoffActions";

describe("Effect creator handoff", () => {
  it("passes only the stable item ID and typed component token", () => {
    expect(effectCreatorHandoffSearch("item-1", "avatar_effect")).toEqual({
      component: "item-1",
      componentType: "avatar_effect",
    });
  });
});
