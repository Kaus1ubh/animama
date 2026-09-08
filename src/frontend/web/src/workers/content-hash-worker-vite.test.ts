import { describe, expect, it } from "vitest";

import {
  devOptimizedDependencies,
  localViteAllowedHosts,
} from "../../vite.config";

describe("Asset hashing worker dev startup", () => {
  it("pre-optimizes the worker-only hash dependency before the first upload", () => {
    expect(devOptimizedDependencies).toContain("@noble/hashes/sha2.js");
  });

  it("admits only the private Compose hostname used by the Hono proxy", () => {
    expect(localViteAllowedHosts).toEqual(["web"]);
  });
});
