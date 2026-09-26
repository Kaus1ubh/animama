import { afterEach, describe, expect, it, vi } from "vitest";

import { preferredClientLocale } from "@animama/product-ui/chat";

describe("preferred client locale", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefers a locale that names a region", () => {
    vi.stubGlobal("navigator", {
      language: "en",
      languages: ["en", "en-GB", "fr-FR"],
    });
    expect(preferredClientLocale()).toBe("en-GB");
  });

  it("falls back to the first locale without a region", () => {
    vi.stubGlobal("navigator", { language: "en", languages: ["en"] });
    expect(preferredClientLocale()).toBe("en");
  });
});
