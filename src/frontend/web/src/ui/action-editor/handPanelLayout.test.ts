import { describe, expect, it } from "vitest";
import { handPanelLayout } from "./handPanelLayout";

describe("hand panel placement", () => {
  it("keeps adjacent controls apart in a roomy stage", () => {
    const layout = handPanelLayout(1198, 1440, 0);
    expect(layout.adjacent).toBe(true);
    expect(layout.left).toBeGreaterThanOrEqual(32 + 288 + 12);
    expect(layout.left + 280 + 12).toBeLessThanOrEqual(1198 - 32 - 296);
  });
  it("replaces the bone browser when an expanded sidebar leaves too little room", () => {
    expect(handPanelLayout(782, 1024, 0)).toEqual({
      adjacent: false,
      left: 16,
    });
  });
  it("reserves the collapsed sidebar rail", () => {
    expect(handPanelLayout(1024, 1024, 56).left).toBeGreaterThanOrEqual(72);
  });
});
