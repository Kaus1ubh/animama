import { describe, expect, it } from "vitest";

import { crisisCardCornerBottom } from "./crisisCardCorner";

const box = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

describe("crisisCardCornerBottom", () => {
  it("uses the true corner when the card fits beside the input region", () => {
    // 1800px panel, 800px centered input region ending at x=1300.
    expect(
      crisisCardCornerBottom(
        box(0, 0, 1800, 1000),
        box(500, 860, 1300, 1000),
        384,
      ),
    ).toBe(16);
  });

  it("lifts the card above the input region when they would overlap", () => {
    // 1200px panel: a 384px card would start at x=800, inside the input region.
    expect(
      crisisCardCornerBottom(
        box(0, 0, 1200, 1000),
        box(200, 860, 1000, 1000),
        384,
      ),
    ).toBe(148);
  });

  it("uses the card's measured width", () => {
    // A 432px card (18px rem) no longer fits where a 384px card would.
    expect(
      crisisCardCornerBottom(
        box(0, 0, 1760, 1000),
        box(520, 860, 1320, 1000),
        432,
      ),
    ).toBe(148);
    expect(
      crisisCardCornerBottom(
        box(0, 0, 1760, 1000),
        box(520, 860, 1320, 1000),
        384,
      ),
    ).toBe(16);
  });
});
