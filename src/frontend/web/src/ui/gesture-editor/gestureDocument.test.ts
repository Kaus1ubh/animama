import { describe, expect, it } from "vitest";
import { createGestureDocument } from "./gestureDocument";

describe("gestureDocument", () => {
  it("derives a reviewable selector from the initial name", () => {
    expect(createGestureDocument("Double Peace").semanticKey).toBe(
      "double_peace",
    );
  });
});
