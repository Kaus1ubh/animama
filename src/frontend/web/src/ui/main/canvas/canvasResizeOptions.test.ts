import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { CONTINUOUS_CANVAS_RESIZE } from "./canvasResizeOptions";

describe("continuous Canvas resizing", () => {
  it("disables both measurement debounce paths", () => {
    expect(CONTINUOUS_CANVAS_RESIZE).toEqual({
      debounce: { scroll: 0, resize: 0 },
    });
  });

  it.each([
    "./Scene.tsx",
    "../../avatar-preview/AvatarPreviewSurface.tsx",
    "../../create/CreateAnimaAvatarPreviewScene.tsx",
  ])("keeps %s synchronized with animated AppShell geometry", async (path) => {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    expect(source).toContain("CONTINUOUS_CANVAS_RESIZE");
    expect(source).toContain("resize={CONTINUOUS_CANVAS_RESIZE}");
  });
});
