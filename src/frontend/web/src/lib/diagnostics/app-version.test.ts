import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

const version = (path: string) =>
  (
    JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as {
      version: string;
    }
  ).version;

it("keeps web and desktop package versions aligned for About", () => {
  // The web build reports its package version; the packaged desktop app is
  // versioned from desktop/package.json. They must describe the same release.
  expect(version("../../../package.json")).toBe(
    version("../../../../desktop/package.json"),
  );
});
