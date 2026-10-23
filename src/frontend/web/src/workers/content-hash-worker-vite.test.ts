import { existsSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  devDependencyScanEntries,
  devOptimizedDependencies,
  localViteAllowedHosts,
} from "../../vite.config";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("Dev server dependency scan", () => {
  it("scans existing pages the dev server serves", () => {
    for (const entry of devDependencyScanEntries) {
      expect(existsSync(`${webRoot}/${entry}`), entry).toBe(true);
    }
  });

  it("skips the landing stage page, whose program is a stage-only virtual module", () => {
    expect(devDependencyScanEntries).not.toContain(
      "scripts/landing-stage/index.html",
    );
    expect(devDependencyScanEntries).toContain("index.html");
  });
});

describe("Asset hashing worker dev startup", () => {
  it("pre-optimizes the worker-only hash dependency before the first upload", () => {
    expect(devOptimizedDependencies).toContain("@noble/hashes/sha2.js");
  });

  it("keeps host protection enabled for the configured application hostname", () => {
    const publicOrigin =
      process.env.ANIMAMA_PUBLIC_ORIGIN ?? "http://localhost:8000";
    expect(localViteAllowedHosts).toEqual([new URL(publicOrigin).hostname]);
  });
});
