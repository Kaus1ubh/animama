import { describe, expect, it } from "vitest";

import type { PyModelProviderCatalogItem } from "@animama/runtime-contracts/api-types";

import {
  defaultReasoningEffort,
  supportedReasoningEfforts,
} from "./model-catalog";

const EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"];

function row(
  extra: Partial<PyModelProviderCatalogItem> = {},
): PyModelProviderCatalogItem {
  return {
    id: "row",
    model: "row",
    model_provider: "OpenAIResponsesHTTPAgent",
    supports_reasoning: true,
    supported_reasoning_efforts: EFFORTS,
    ...extra,
  } as PyModelProviderCatalogItem;
}

describe("chat picker reasoning effort", () => {
  it("preselects the row's reported default, such as Anthropic's medium", () => {
    const haiku = row({
      id: "AnthropicMessagesHTTPAgent:claude-haiku-5-5",
      model_provider: "AnthropicMessagesHTTPAgent",
      default_reasoning_effort: "medium",
    });
    expect(defaultReasoningEffort(haiku)).toBe("medium");
  });

  it("falls back to the first supported effort when the row reports none", () => {
    expect(
      defaultReasoningEffort(row({ default_reasoning_effort: null })),
    ).toBe("none");
    expect(defaultReasoningEffort(row())).toBe("none");
  });

  it("ignores a reported default the row does not offer", () => {
    expect(
      defaultReasoningEffort(
        row({
          supported_reasoning_efforts: ["low", "high"],
          default_reasoning_effort: "medium",
        }),
      ),
    ).toBe("low");
  });

  it("has no effort for rows without efforts", () => {
    expect(defaultReasoningEffort(null)).toBeNull();
    expect(
      defaultReasoningEffort(
        row({
          supported_reasoning_efforts: null,
          default_reasoning_effort: "medium",
        }),
      ),
    ).toBeNull();
    expect(supportedReasoningEfforts(undefined)).toEqual([]);
  });
});
