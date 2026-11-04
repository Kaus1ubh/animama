import { describe, expect, it } from "vitest";

import { runtimeRemountRecovery } from "@animama/product-ui/chat";

describe("runtimeRemountRecovery", () => {
  it("preserves text and never retries against a different revision", () => {
    expect(runtimeRemountRecovery("hello again")).toEqual({
      preserveText: "hello again",
      removeOptimisticRun: true,
      retryAutomatically: false,
      requiresExplicitRemount: true,
    });
  });
});
