import { describe, expect, it } from "vitest";

import { isGeneratedAvatarPortrait } from "./useAppearanceImages";

describe("isGeneratedAvatarPortrait", () => {
  it("recognises an Appearance saved as an Avatar's portrait", () => {
    expect(
      isGeneratedAvatarPortrait({
        metadata: { presentation: { avatar_item_id: "avatar-1" } },
      }),
    ).toBe(true);
  });

  it.each([
    ["an ordinary picture", { metadata: { presentation: {} } }],
    ["a picture without metadata", { metadata: null }],
    [
      "an Included portrait matched by model name",
      { metadata: { avatar_model: "Andrew" } },
    ],
  ])("keeps %s", (_name, item) => {
    expect(isGeneratedAvatarPortrait(item)).toBe(false);
  });
});
