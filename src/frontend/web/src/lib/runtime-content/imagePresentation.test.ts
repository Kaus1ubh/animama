import { describe, expect, it } from "vitest";

import {
  applyRuntimeImageDrag,
  applyRuntimeImageLayoutDrag,
  getRuntimeImageLayout,
  normalizeRuntimeImagePresentation,
  runtimeImageConfig,
  runtimeImageStyle,
} from "./imagePresentation";

describe("runtime image presentation", () => {
  it("defaults and clamps persisted values", () => {
    expect(normalizeRuntimeImagePresentation({})).toEqual({
      fit: "cover",
      focal_x: 0.5,
      focal_y: 0.5,
      zoom: 1,
    });
    expect(
      normalizeRuntimeImagePresentation({
        fit: "contain",
        focal_x: -2,
        focal_y: 5,
        zoom: 12,
      }),
    ).toEqual({ fit: "contain", focal_x: 0, focal_y: 1, zoom: 4 });
  });

  it("clamps drag updates and keeps them independent of frame aspect ratio", () => {
    const base = normalizeRuntimeImagePresentation({ zoom: 2 });
    expect(
      applyRuntimeImageDrag({
        presentation: base,
        frameWidth: 200,
        frameHeight: 100,
        deltaX: 1000,
        deltaY: -1000,
      }),
    ).toEqual({ ...base, focal_x: 0, focal_y: 1 });
  });

  it("preserves unrelated config and emits reusable CSS", () => {
    const presentation = normalizeRuntimeImagePresentation({
      focal_x: 0.25,
      focal_y: 0.75,
      zoom: 2,
    });
    expect(
      runtimeImageConfig({ label: "Portrait", position: "left" }, presentation),
    ).toEqual({
      label: "Portrait",
      fit: "cover",
      focal_x: 0.25,
      focal_y: 0.75,
      zoom: 2,
    });
    expect(runtimeImageStyle(presentation)).toMatchObject({
      objectPosition: "25% 75%",
      transform: "scale(2)",
    });
  });

  it("lays out cover and contain images beyond a normalized crop frame", () => {
    expect(
      getRuntimeImageLayout({
        presentation: normalizeRuntimeImagePresentation({ fit: "cover" }),
        frameWidth: 160,
        frameHeight: 90,
        imageWidth: 100,
        imageHeight: 100,
      }),
    ).toEqual({ width: 160, height: 160, left: 0, top: -35 });

    expect(
      getRuntimeImageLayout({
        presentation: normalizeRuntimeImagePresentation({ fit: "contain" }),
        frameWidth: 160,
        frameHeight: 90,
        imageWidth: 100,
        imageHeight: 100,
      }),
    ).toEqual({ width: 90, height: 90, left: 35, top: 0 });
  });

  it("clamps editor drags to the available excluded image area", () => {
    const base = normalizeRuntimeImagePresentation({ fit: "cover" });
    expect(
      applyRuntimeImageLayoutDrag({
        presentation: base,
        frameWidth: 160,
        frameHeight: 90,
        imageWidth: 100,
        imageHeight: 100,
        deltaX: 0,
        deltaY: 1000,
      }),
    ).toEqual({ ...base, focal_y: 0 });
  });
});
