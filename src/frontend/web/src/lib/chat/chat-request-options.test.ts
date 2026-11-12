import { describe, expect, it } from "vitest";

import type { PyModelProviderCatalogItem } from "@animama/runtime-contracts/api-types";

import { chatRequestOptions } from "./chat-request-options";

const LUNA = "OpenAIResponsesHTTPAgent:gpt-6-luna";
const luna = {
  id: LUNA,
  model: "gpt-6-luna",
  model_provider: "OpenAIResponsesHTTPAgent",
  supports_tools: true,
  supports_reasoning: true,
  supported_reasoning_efforts: ["none", "low", "medium"],
  requestable_native_tool_support: ["web_search"],
} as PyModelProviderCatalogItem;

const base = {
  animaId: "anima-1",
  item: luna,
  savedEffort: null,
  webSearch: undefined,
  featureChoice: null,
};

describe("chat request options", () => {
  it("sends the model's default effort and every available tool by default", () => {
    expect(chatRequestOptions(base)).toEqual({
      reasoning_effort: "none",
      native_tools: ["web_search"],
    });
  });

  it("sends the Anima's saved effort", () => {
    expect(
      chatRequestOptions({ ...base, savedEffort: "low" })?.reasoning_effort,
    ).toBe("low");
  });

  it("applies a Chat features choice only to its own Anima and model", () => {
    const featureChoice = {
      animaId: "anima-1",
      modelProviderId: LUNA,
      nativeTools: [],
    };

    expect(
      chatRequestOptions({ ...base, featureChoice })?.native_tools,
    ).toBeUndefined();
    expect(
      chatRequestOptions({
        ...base,
        animaId: "anima-2",
        featureChoice,
      })?.native_tools,
    ).toEqual(["web_search"]);
    expect(
      chatRequestOptions({
        ...base,
        featureChoice: { ...featureChoice, modelProviderId: "other:model" },
      })?.native_tools,
    ).toEqual(["web_search"]);
  });

  it("has no options before the model row is known", () => {
    expect(chatRequestOptions({ ...base, item: null })).toBeNull();
  });
});
