import { afterEach, describe, expect, it, vi } from "vitest";
import { getI18n } from "react-i18next";

import {
  currentChatClientContext,
  preferredClientLocale,
} from "@animama/product-ui/chat";

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

describe("chat client context under another UI Locale (spec R6)", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await getI18n().changeLanguage("en");
  });

  it("keeps reporting the browser's locale, so the crisis region never follows the UI", async () => {
    vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
    const english = currentChatClientContext();

    await getI18n().changeLanguage("ja");

    expect(getI18n().language).toBe("ja");
    expect(currentChatClientContext()).toEqual(english);
    expect(currentChatClientContext().locale).toBe("en-US");
  });
});
