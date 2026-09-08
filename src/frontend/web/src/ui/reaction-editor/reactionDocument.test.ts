import { describe, expect, it } from "vitest";
import { createReactionDocument } from "./reactionDocument";

describe("reactionDocument", () => {
  it("starts with a canonical suggested placement and no role choice", () => {
    const value = createReactionDocument("admiration", 2);
    expect(value.intent).toBe("reaction");
    expect(value.suggestedEmotion).toBe("admiration");
    expect(value.suggestedIntensity).toBe(2);
  });
});
