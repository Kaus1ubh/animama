import { describe, expect, it } from "vitest";
import { creatorDocumentOffset } from "./CreatorHeaderDocument";

describe("creator title placement", () => {
  it("centers on the content viewport when the control gap has room", () => {
    expect(creatorDocumentOffset(1000, 700, 800, 380)).toBe(-100);
  });
  it("stops before the leading controls at narrower desktop widths", () => {
    expect(creatorDocumentOffset(600, 700, 500, 380)).toBe(-60);
  });
  it("stops before trailing controls", () => {
    expect(creatorDocumentOffset(1200, 400, 500, 380)).toBe(60);
  });
  it("keeps the full-width mobile field in its own grid track", () => {
    expect(creatorDocumentOffset(195, 8, 260, 260)).toBe(0);
  });
});
