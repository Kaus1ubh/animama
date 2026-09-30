import { describe, expect, it } from "vitest";

import type { PyWebSearchSettings } from "@animama/runtime-contracts/api-types";

import {
  draftFromSettings,
  testResultMessage,
  webSearchRequest,
  type WebSearchDraft,
} from "./web-search-state";

const MANAGED = "ANIMAMA_CONNECTION_WEB_SEARCH_API_KEY";

const unconfigured: PyWebSearchSettings = {
  configured: false,
  managed_credential_env: MANAGED,
};

function draft(patch: Partial<WebSearchDraft>): WebSearchDraft {
  return { ...draftFromSettings(unconfigured), ...patch };
}

describe("web search settings drafts", () => {
  it("starts off without a backend and suggests the Brave variable", () => {
    expect(draftFromSettings(unconfigured)).toEqual({
      backend: "off",
      baseUrl: "",
      key: "",
      envName: "BRAVE_SEARCH_API_KEY",
      timeout: "",
    });
  });

  it("loads saved settings without any key value", () => {
    expect(
      draftFromSettings({
        configured: true,
        backend: "brave",
        credential_env: MANAGED,
        credential_state: "configured",
        managed_credential_env: MANAGED,
        timeout_seconds: 8,
      }),
    ).toMatchObject({ backend: "brave", key: "", timeout: "8" });
  });
});

describe("web search settings requests", () => {
  it("sends a SearXNG address without a key", () => {
    expect(
      webSearchRequest(
        draft({ backend: "searxng", baseUrl: " http://127.0.0.1:8888 " }),
        { managedKeys: true, savedManagedKey: false },
      ),
    ).toEqual({
      backend: "searxng",
      base_url: "http://127.0.0.1:8888",
      credential: { mode: "none" },
      timeout_seconds: null,
    });
  });

  it("stores a desktop Brave key in the vault", () => {
    const managed = { managedKeys: true, savedManagedKey: false };
    expect(
      webSearchRequest(draft({ backend: "brave", key: "k" }), managed),
    ).toMatchObject({ backend: "brave", credential: { mode: "managed" } });
    // No key typed and none saved: Brave cannot be saved.
    expect(webSearchRequest(draft({ backend: "brave" }), managed)).toBeNull();
    // A saved key is kept.
    expect(
      webSearchRequest(draft({ backend: "brave" }), {
        managedKeys: true,
        savedManagedKey: true,
      }),
    ).toMatchObject({ credential: { mode: "managed" } });
  });

  it("names the environment variable on self-hosted web", () => {
    const selfHosted = { managedKeys: false, savedManagedKey: false };
    expect(
      webSearchRequest(draft({ backend: "brave" }), selfHosted),
    ).toMatchObject({
      credential: { mode: "env", env: "BRAVE_SEARCH_API_KEY" },
    });
    expect(
      webSearchRequest(draft({ backend: "brave", envName: " " }), selfHosted),
    ).toBeNull();
  });

  it("rejects an invalid timeout and an empty SearXNG address", () => {
    const managed = { managedKeys: true, savedManagedKey: false };
    expect(
      webSearchRequest(
        draft({ backend: "searxng", baseUrl: "http://x", timeout: "0" }),
        managed,
      ),
    ).toBeNull();
    expect(
      webSearchRequest(draft({ backend: "searxng", baseUrl: "" }), managed),
    ).toBeNull();
    expect(
      webSearchRequest(
        draft({ backend: "searxng", baseUrl: "http://x", timeout: "12.5" }),
        managed,
      ),
    ).toMatchObject({ timeout_seconds: 12.5 });
    expect(webSearchRequest(draft({ backend: "off" }), managed)).toBeNull();
  });
});

describe("web search test results", () => {
  it("reports a working backend", () => {
    expect(testResultMessage({ ok: true, result_count: 3 })).toBe(
      "Search works: 3 results for a test query.",
    );
    expect(testResultMessage({ ok: true, result_count: 1 })).toBe(
      "Search works: 1 result for a test query.",
    );
  });

  it("explains each failure category without server text", () => {
    expect(
      testResultMessage({ ok: false, category: "json_format_disabled" }),
    ).toMatch(/search\.formats/u);
    expect(
      testResultMessage({ ok: false, category: "credential_rejected" }),
    ).toBe("Brave Search rejected the key.");
    expect(testResultMessage({ ok: false, category: "surprise" })).toBe(
      "The search service returned an unexpected response.",
    );
  });
});
