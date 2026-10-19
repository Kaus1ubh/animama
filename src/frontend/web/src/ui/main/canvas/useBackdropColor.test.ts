// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Rgb } from "@/lib/avatar/enhanced-rendering/backdropGlow";
import { type Backdrop, useBackdropColor } from "./useBackdropColor";

const sampling = vi.hoisted(() => ({
  imageColors: new Map<string, Rgb | null>(),
  cssColorToRgb: vi.fn((): Rgb | null => [10, 10, 10]),
}));

vi.mock("@/lib/avatar/enhanced-rendering/sampleBackdrop", () => ({
  sampleImageColor: (src: string) =>
    Promise.resolve(sampling.imageColors.get(src) ?? null),
  cssColorToRgb: sampling.cssColorToRgb,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const elementRef = { current: document.createElement("div") };
const container = document.createElement("div");
let root: Root | null = null;

/** Renders the hook's colour as JSON text. */
function Probe({ backdrop }: { backdrop: Backdrop }) {
  return JSON.stringify(useBackdropColor(backdrop, elementRef));
}

function shownColor(): Rgb | null {
  return JSON.parse(container.textContent ?? "null") as Rgb | null;
}

/**
 * Render the probe with `backdrop`, then let any image sample settle.
 * Returns the colour shown before it settled.
 */
async function show(backdrop: Backdrop) {
  act(() => {
    root ??= createRoot(container);
    root.render(createElement(Probe, { backdrop }));
  });
  const beforeSettling = shownColor();
  await act(async () => {});
  return beforeSettling;
}

describe("useBackdropColor", () => {
  beforeEach(() => {
    sampling.imageColors.clear();
    sampling.cssColorToRgb.mockReset();
    sampling.cssColorToRgb.mockReturnValue([10, 10, 10]);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.documentElement.className = "";
    document.head.querySelectorAll("style").forEach((style) => style.remove());
  });

  it("knows no colour without a backdrop", async () => {
    await show(null);
    expect(shownColor()).toBeNull();
    expect(sampling.cssColorToRgb).not.toHaveBeenCalled();
  });

  it("averages the backdrop image once it has loaded", async () => {
    sampling.imageColors.set("/night.webp", [20, 30, 70]);
    expect(await show({ kind: "image", src: "/night.webp" })).toBeNull();
    expect(shownColor()).toEqual([20, 30, 70]);
  });

  it("drops the previous colour while a new image loads", async () => {
    sampling.imageColors.set("/day.webp", [240, 240, 240]);
    sampling.imageColors.set("/night.webp", [20, 30, 70]);
    await show({ kind: "image", src: "/day.webp" });
    expect(shownColor()).toEqual([240, 240, 240]);

    expect(await show({ kind: "image", src: "/night.webp" })).toBeNull();
    expect(shownColor()).toEqual([20, 30, 70]);
  });

  it("reads the element background again once the theme class lands", async () => {
    await show({ kind: "element" });
    expect(shownColor()).toEqual([10, 10, 10]);

    sampling.cssColorToRgb.mockReturnValue([26, 29, 35]);
    await act(async () => {
      document.documentElement.classList.add("dark");
    });
    expect(shownColor()).toEqual([26, 29, 35]);
  });

  it("reads the element background again when colour overrides change", async () => {
    await show({ kind: "element" });
    sampling.cssColorToRgb.mockReturnValue([16, 16, 24]);
    await act(async () => {
      const style = document.createElement("style");
      style.textContent = ":root { --background: #101018; }";
      document.head.appendChild(style);
    });
    expect(shownColor()).toEqual([16, 16, 24]);
  });

  it("stops reading the element background when the backdrop changes", async () => {
    await show({ kind: "element" });
    await show(null);
    sampling.cssColorToRgb.mockClear();
    await act(async () => {
      document.documentElement.classList.toggle("dark");
    });
    expect(sampling.cssColorToRgb).not.toHaveBeenCalled();
  });
});
