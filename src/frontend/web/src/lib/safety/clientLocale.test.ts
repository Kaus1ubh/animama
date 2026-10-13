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

describe("chat client context under another UI Locale (spec R6, ADR 0024)", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await getI18n().changeLanguage("en");
  });

  it("keeps reporting the browser's locale, so the crisis region never follows the UI", async () => {
    vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
    const english = currentChatClientContext();
    expect(english.ui_locale).toBe("en");

    await getI18n().changeLanguage("ja");

    const japanese = currentChatClientContext();
    expect(japanese.locale).toBe("en-US");
    expect(japanese.time_zone).toBe(english.time_zone);
    // Only the conversation language follows the UI.
    expect(japanese.ui_locale).toBe("ja");
  });

  it("reports no conversation language under the pseudo-locale", async () => {
    await getI18n().changeLanguage("en-XA");
    expect(currentChatClientContext().ui_locale).toBeNull();
  });
});
