import { afterEach, describe, expect, it, vi } from "vitest";

import {
  initialLocale,
  pseudoLocaleActive,
  rememberAppliedLocale,
} from "./locale-preference";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

function stubBrowser({
  search = "",
  languages = ["en-US"],
}: { search?: string; languages?: string[] } = {}) {
  const window = {
    location: { search },
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
  };
  vi.stubGlobal("window", window);
  vi.stubGlobal("navigator", { languages, language: languages[0] });
  return window;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("first-paint UI Locale", () => {
  it("follows the system language list before anything was applied", () => {
    stubBrowser({ languages: ["fr-FR", "ko-KR"] });
    expect(initialLocale()).toBe("ko");
  });

  it("prefers the locale this browser last applied", () => {
    stubBrowser({ languages: ["en-US"] });
    rememberAppliedLocale("zh-Hant");
    expect(initialLocale()).toBe("zh-Hant");
  });

  it("ignores a remembered value outside the supported locales", () => {
    const window = stubBrowser({ languages: ["ja-JP"] });
    window.localStorage.setItem("animama.ui-locale.applied", "en-US");
    expect(initialLocale()).toBe("ja");
  });

  it("keeps the development pseudo-locale for the tab once requested", () => {
    const window = stubBrowser({ search: "?ui-locale=pseudo" });
    expect(initialLocale()).toBe("en-XA");
    window.location.search = "";
    expect(pseudoLocaleActive()).toBe(true);
    window.location.search = "?ui-locale=off";
    expect(pseudoLocaleActive()).toBe(false);
  });
});
