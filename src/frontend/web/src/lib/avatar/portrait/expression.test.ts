import { describe, expect, it } from "vitest";

import { resolveAvatarPortraitHappyExpression } from "./expression";

describe("resolveAvatarPortraitHappyExpression", () => {
  it("prefers the exact lowercase expression", () => {
    expect(
      resolveAvatarPortraitHappyExpression(["Happy", "happy", "HAPPY"]),
    ).toBe("happy");
  });

  it.each(["Happy", "HAPPY"])(
    "accepts the case-insensitive %s expression",
    (name) => {
      expect(resolveAvatarPortraitHappyExpression(["sad", name])).toBe(name);
    },
  );

  it("uses stable lexical ordering for case-colliding names", () => {
    const first = resolveAvatarPortraitHappyExpression(["HAPPY", "Happy"]);
    const second = resolveAvatarPortraitHappyExpression(["Happy", "HAPPY"]);
    expect(first).toBe(second);
  });

  it("falls back to a neutral capture when happy is absent", () => {
    expect(resolveAvatarPortraitHappyExpression(["sad", "neutral"])).toBeNull();
  });
});
