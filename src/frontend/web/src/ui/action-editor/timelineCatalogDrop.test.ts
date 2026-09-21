import { describe, expect, it } from "vitest";
import {
  resolveTimelineDropTime,
  timelinePointerTime,
} from "./timelineCatalogDrop";

const rect = { left: 100, top: 200, width: 888, height: 176 };

describe("catalog timeline coordinates", () => {
  it("uses the visible time area rather than the label rail", () => {
    expect(timelinePointerTime(572, rect, 2)).toBe(1);
    expect(
      resolveTimelineDropTime({ x: 572, y: 250 }, rect, 2, false, 0.05),
    ).toBe(1);
    expect(
      resolveTimelineDropTime({ x: 150, y: 250 }, rect, 2, false, 0.05),
    ).toBeNull();
    expect(
      resolveTimelineDropTime({ x: 572, y: 190 }, rect, 2, false, 0.05),
    ).toBeNull();
  });
  it("snaps the preview and commit to the same bounded time", () => {
    expect(
      resolveTimelineDropTime({ x: 438, y: 250 }, rect, 2, true, 0.1),
    ).toBe(0.7);
    expect(
      resolveTimelineDropTime({ x: 438, y: 250 }, rect, 2, false, 0.1),
    ).toBe(0.665);
    expect(
      resolveTimelineDropTime({ x: 172, y: 200 }, rect, 2, true, 0.1),
    ).toBe(0);
    expect(
      resolveTimelineDropTime({ x: 972, y: 370 }, rect, 2, true, 0.3),
    ).toBe(2);
    expect(
      resolveTimelineDropTime({ x: 973, y: 250 }, rect, 2, true, 0.1),
    ).toBeNull();
  });
  it("handles empty duration and geometry changes", () => {
    expect(
      resolveTimelineDropTime({ x: 572, y: 250 }, rect, 0, true, 0.1),
    ).toBe(0);
    expect(
      resolveTimelineDropTime(
        { x: 572, y: 250 },
        { ...rect, width: 1688 },
        2,
        false,
        0.1,
      ),
    ).toBe(0.5);
  });
});
