import { describe, expect, it } from "vitest";

import {
  devOptimizedDependencies,
  localViteAllowedHosts,
} from "../../vite.config";

describe("Asset hashing worker dev startup", () => {
  it("pre-optimizes the worker-only hash dependency before the first upload", () => {
    expect(devOptimizedDependencies).toContain("@noble/hashes/sha2.js");
  });

  it("keeps host protection enabled for the configured application hostname", () => {
    const publicOrigin =
      process.env.ANIMAMA_PUBLIC_ORIGIN ?? "http://localhost:3000";
    expect(localViteAllowedHosts).toEqual([new URL(publicOrigin).hostname]);
  });
});
