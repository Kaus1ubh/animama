import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFile(new URL(path, import.meta.url), "utf8");

describe("application entrypoints", () => {
  it("load the theme's DM Sans font in both compositions", async () => {
    const [theme, local, hosted] = await Promise.all([
      source("../styles/globals.css"),
      source("../main.local.tsx"),
      source("../main.hosted.tsx"),
    ]);
    expect(theme).toContain('"DM Sans Variable"');
    for (const entry of [local, hosted])
      expect(entry).toContain('import "@fontsource-variable/dm-sans";');
  });
});
