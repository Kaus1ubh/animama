import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_FONT_PREVIEW,
  readFontPreview,
  writeFontPreview,
} from "./font-preview";

/** Minimal stand-ins for the browser storage and root style the module uses. */
function createStyle() {
  const values = new Map<string, string>();
  return {
    setProperty: (name: string, value: string) => values.set(name, value),
    removeProperty: (name: string) => values.delete(name),
    getPropertyValue: (name: string) => values.get(name) ?? "",
  };
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

let style: ReturnType<typeof createStyle>;
let storage: ReturnType<typeof createStorage>;
const root = () => style;

describe("font preview", () => {
  beforeEach(() => {
    style = createStyle();
    storage = createStorage();
    vi.stubGlobal("document", { documentElement: { style } });
    vi.stubGlobal("window", { localStorage: storage });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("defaults to the theme typeface and weight", () => {
    expect(readFontPreview()).toEqual(DEFAULT_FONT_PREVIEW);
  });

  it("persists and applies a chosen typeface and weight", () => {
    writeFontPreview({ font: "figtree", weight: 500 });

    expect(readFontPreview()).toEqual({ font: "figtree", weight: 500 });
    expect(root().getPropertyValue("--app-font-sans")).toContain(
      "Figtree Variable",
    );
    expect(root().getPropertyValue("--app-body-weight")).toBe("500");
  });

  it("clears overrides when returning to the default", () => {
    writeFontPreview({ font: "geist", weight: 600 });
    writeFontPreview(DEFAULT_FONT_PREVIEW);

    expect(root().getPropertyValue("--app-font-sans")).toBe("");
    expect(root().getPropertyValue("--app-body-weight")).toBe("");
  });

  it("falls back to defaults for unknown or corrupt stored values", () => {
    storage.setItem(
      "animama.fontPreview",
      JSON.stringify({ font: "comic-sans", weight: 900 }),
    );
    expect(readFontPreview()).toEqual(DEFAULT_FONT_PREVIEW);

    storage.setItem("animama.fontPreview", "{not json");
    expect(readFontPreview()).toEqual(DEFAULT_FONT_PREVIEW);
  });
});
