import { describe, expect, it } from "vitest";

import { scrollAnimaCarouselWithWheel } from "./AnimaCarousel";

describe("Anima carousel wheel navigation", () => {
  it("uses vertical wheel movement to scroll the horizontal carousel", () => {
    const element = { clientWidth: 300, scrollLeft: 100, scrollWidth: 900 };

    expect(scrollAnimaCarouselWithWheel(element, 0, 120)).toBe(true);
    expect(element.scrollLeft).toBe(220);
  });

  it("normalizes physical mouse-wheel line deltas", () => {
    const element = { clientWidth: 300, scrollLeft: 100, scrollWidth: 900 };

    expect(scrollAnimaCarouselWithWheel(element, 0, 3, 1)).toBe(true);
    expect(element.scrollLeft).toBe(220);
  });

  it("leaves horizontal wheel gestures and boundary scrolling alone", () => {
    const horizontal = {
      clientWidth: 300,
      scrollLeft: 100,
      scrollWidth: 900,
    };
    expect(scrollAnimaCarouselWithWheel(horizontal, 120, 20)).toBe(false);
    expect(horizontal.scrollLeft).toBe(100);

    const atEnd = { clientWidth: 300, scrollLeft: 600, scrollWidth: 900 };
    expect(scrollAnimaCarouselWithWheel(atEnd, 0, 120)).toBe(false);
    expect(atEnd.scrollLeft).toBe(600);
  });
});
