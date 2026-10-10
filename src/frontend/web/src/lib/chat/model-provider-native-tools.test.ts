import { describe, expect, it } from "vitest";

import type { PyModelProviderCatalogItem } from "@/lib/content/catalogTypes";

import {
  filterRequestableNativeTools,
  requestableNativeTools,
  selectableNativeTools,
  webSearchAvailability,
  withWebSearch,
} from "./model-provider-native-tools";

const hostedRow = {
  requestable_native_tool_support: ["web_search"],
  supports_tools: true,
} as PyModelProviderCatalogItem;
const toolRow = {
  requestable_native_tool_support: [],
  supports_tools: true,
} as unknown as PyModelProviderCatalogItem;
const noToolRow = {
  supports_tools: false,
} as PyModelProviderCatalogItem;
const anthropicHostedRow = {
  model_provider: "AnthropicMessagesHTTPAgent",
  requestable_native_tool_support: ["web_search"],
  supports_tools: true,
} as PyModelProviderCatalogItem;
const anthropicToolRow = {
  model_provider: "AnthropicMessagesHTTPAgent",
  requestable_native_tool_support: [],
  supports_tools: true,
} as unknown as PyModelProviderCatalogItem;

const configured = {
  configuration: true,
  configured: true,
  backend: "searxng",
  credential_state: "not_required",
} as const;
const notConfigured = { configuration: true, configured: false } as const;

describe("web search availability", () => {
  it("keeps hosted search on rows whose provider hosts it", () => {
    expect(webSearchAvailability(hostedRow, notConfigured)).toEqual({
      state: "hosted",
    });
    expect(webSearchAvailability(hostedRow, undefined)).toEqual({
      state: "hosted",
    });
  });

  it("offers the application tool on tool-capable rows once a backend is configured", () => {
    expect(webSearchAvailability(toolRow, configured)).toEqual({
      state: "application",
    });
    expect(selectableNativeTools(toolRow, configured)).toEqual(["web_search"]);
  });

  it("explains why search is unavailable", () => {
    expect(webSearchAvailability(toolRow, notConfigured)).toEqual({
      state: "unavailable",
      reason: "Set up web search in App Settings.",
    });
    expect(webSearchAvailability(noToolRow, configured)).toEqual({
      state: "unavailable",
      reason: "This model can't call tools, so it can't search.",
    });
    expect(
      webSearchAvailability(toolRow, {
        ...configured,
        backend: "brave",
        credential_state: "missing",
      }),
    ).toEqual({
      state: "unavailable",
      reason:
        "The Brave Search key is not set. See Web search in App Settings.",
    });
    expect(selectableNativeTools(toolRow, notConfigured)).toEqual([]);
  });

  it("shows nothing where the owner cannot configure search", () => {
    expect(webSearchAvailability(toolRow, undefined)).toBeNull();
    expect(
      webSearchAvailability(toolRow, {
        configuration: false,
        configured: false,
      }),
    ).toBeNull();
    expect(selectableNativeTools(toolRow, undefined)).toEqual([]);
  });

  it("turns search on or off without touching other tools or an empty choice", () => {
    expect(withWebSearch(["code_interpreter"], true)).toEqual([
      "code_interpreter",
      "web_search",
    ]);
    expect(withWebSearch(["web_search", "code_interpreter"], false)).toEqual([
      "code_interpreter",
    ]);
    expect(withWebSearch(["web_search"], true)).toEqual(["web_search"]);
    expect(withWebSearch(undefined, false)).toEqual([]);
  });

  it("never offers the application tool on Anthropic rows", () => {
    expect(webSearchAvailability(anthropicHostedRow, configured)).toEqual({
      state: "hosted",
    });
    // Anthropic rows search only with Anthropic's own server tool, so a row
    // without it shows no search control, whatever the app's backend.
    for (const search of [configured, notConfigured, undefined])
      expect(webSearchAvailability(anthropicToolRow, search)).toBeNull();
    expect(selectableNativeTools(anthropicToolRow, configured)).toEqual([]);
  });

  it("does not add search twice to a hosted row", () => {
    expect(selectableNativeTools(hostedRow, configured)).toEqual([
      "web_search",
    ]);
  });
});

describe("model provider native tools", () => {
  it("keeps complete capabilities separate from requestable tools", () => {
    const item = {
      native_tool_support: ["apply_patch", "web_search"],
      requestable_native_tool_support: ["web_search"],
    } as PyModelProviderCatalogItem;

    expect(requestableNativeTools(item)).toEqual(["web_search"]);
  });

  it("normalizes and filters requested tools against the backend allowlist", () => {
    expect(
      filterRequestableNativeTools(
        [" web_search ", "apply_patch", "web_search"],
        ["web_search"],
      ),
    ).toEqual(["web_search"]);
  });
});
