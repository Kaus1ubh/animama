import { describe, expect, it } from "vitest";
import type { PyModelProviderCatalogItem } from "@animama/runtime-contracts/api-types";

import {
  DEFAULT_CAPABILITIES_DRAFT,
  capabilitiesFromProbe,
  embeddingsStatusText,
  keyWouldTravelInsecurely,
  modelConfigurationErrorMessage,
  modelInUseUsage,
  removalConsequences,
  removalUsageSummary,
  roleCandidates,
} from "./model-configuration-state";
import {
  modelConnectionLabel,
  modelOptionDetail,
  modelOptionLabel,
  selectableChatModels,
} from "@/lib/chat/model-catalog";

function row(
  id: string,
  extra: Partial<PyModelProviderCatalogItem> = {},
): PyModelProviderCatalogItem {
  return {
    id,
    model: id,
    model_label: id,
    model_provider: "OpenAIHTTPAgent",
    provider_label: "Ollama",
    accepts: ["text"],
    produces: ["text"],
    supports_streaming: true,
    supports_tools: true,
    model_kind: "chat",
    source: "owner",
    hidden: false,
    context_window_tokens: 8192,
    ...extra,
  } as PyModelProviderCatalogItem;
}

describe("model pickers", () => {
  it("offers chat models only and keeps a hidden current choice", () => {
    const items = [
      row("chat"),
      row("hidden", { hidden: true }),
      row("embed", { model_kind: "embedding" }),
    ];
    expect(selectableChatModels(items).map((item) => item.id)).toEqual([
      "chat",
    ]);
    expect(
      selectableChatModels(items, "hidden").map((item) => item.id),
    ).toEqual(["chat", "hidden"]);
  });

  it("offers each role only the models the server accepts for it", () => {
    const items = [
      row("tools"),
      row("no-tools", { supports_tools: false }),
      row("no-window", { context_window_tokens: null }),
      row("builtin-no-window", {
        source: "builtin",
        context_window_tokens: null,
      }),
      row("batch", { supports_streaming: false }),
      row("embed", { model_kind: "embedding", supports_streaming: false }),
      row("hidden", { hidden: true }),
    ];
    const ids = (role: Parameters<typeof roleCandidates>[1]) =>
      roleCandidates(items, role).map((item) => item.id);
    expect(ids("utility")).toEqual(["tools", "no-tools", "builtin-no-window"]);
    expect(ids("memory_manager")).toEqual([
      "tools",
      "no-window",
      "builtin-no-window",
      "batch",
    ]);
    expect(ids("embeddings")).toEqual(["embed"]);
    // A hidden model stays listed while it is the role's current choice.
    expect(
      roleCandidates(items, "utility", "hidden").map((item) => item.id),
    ).toContain("hidden");
  });

  it("groups the built-in OpenAI connection's models under one name", () => {
    const builtin = row("gpt-5.6-luna", {
      connection_id: "openai",
      connection_name: "OpenAI",
      provider_label: "OpenAI Responses HTTP",
      model_provider: "OpenAIResponsesHTTPAgent",
    });
    const owner = row("gpt-6-luna", {
      connection_id: "openai",
      connection_name: "OpenAI",
      provider_label: "OpenAI",
      model_provider: "OpenAIResponsesHTTPAgent",
    });
    expect(modelConnectionLabel(builtin)).toBe("OpenAI");
    expect(modelConnectionLabel(owner)).toBe("OpenAI");
    expect(modelOptionDetail(owner)).toBe("Responses API");
    expect(modelOptionLabel(builtin)).toBe(
      "OpenAI: gpt-5.6-luna (Responses API)",
    );
    const local = row("qwen3:8b", {
      connection_id: "c_0123456789ab",
      connection_name: "Ollama",
    });
    expect(modelOptionDetail(local)).toBe("Ollama");
  });

  it("labels models with fallbacks", () => {
    expect(modelOptionLabel(row("qwen3:8b", { connection_id: "c_1" }))).toBe(
      "Ollama: qwen3:8b",
    );
    expect(
      modelOptionLabel({
        model: "qwen3:8b",
        model_label: null,
        provider_label: null,
      }),
    ).toBe("qwen3:8b");
  });
});

describe("connection safety and errors", () => {
  it.each([
    ["http://192.168.1.20:11434/v1", true],
    ["http://models.example.test/v1", true],
    ["https://models.example.test/v1", false],
    ["http://127.0.0.1:11434/v1", false],
    ["http://localhost:1234/v1", false],
    ["http://host.docker.internal:8080/v1", false],
    ["http://[::1]:8080/v1", false],
    ["not a url", false],
  ])("warns about keys sent over plain http to %s: %s", (url, expected) => {
    expect(keyWouldTravelInsecurely(url)).toBe(expected);
  });

  it("uses category copy for connection failures and never echoes server text", () => {
    expect(
      modelConfigurationErrorMessage({
        detail: {
          code: "unreachable",
          message: "connect ECONNREFUSED secret-host",
        },
      }),
    ).toContain("could not be reached");
    expect(
      modelConfigurationErrorMessage({
        detail: {
          code: "invalid_context_window",
          message: "Context window must be positive",
        },
      }),
    ).toBe("Context window must be positive");
    expect(modelConfigurationErrorMessage(new TypeError("fetch failed"))).toBe(
      "The change could not be saved.",
    );
  });

  it("summarizes what a removal affects", () => {
    const usage = modelInUseUsage({
      detail: {
        code: "model_in_use",
        usage: {
          animas: [
            { anima_id: "a", display_name: "Mira", model_provider_id: "m" },
            { anima_id: "b", display_name: "Luna", model_provider_id: "m" },
          ],
          roles: ["models.utility_model_provider_id"],
        },
      },
    });
    expect(usage && removalUsageSummary(usage)).toBe(
      "Used by Mira and Luna, and as the Utility role.",
    );
    expect(usage && removalConsequences(usage)).toBe(
      "Those Animas show their model as unavailable until you pick another. That role goes back to its default.",
    );
    expect(removalConsequences({ animas: [], roles: [] })).toBe("");
    expect(modelInUseUsage({ detail: { code: "model_read_only" } })).toBeNull();
  });
});

describe("probe and role status", () => {
  it("prefills capabilities from a probe, keeping undetermined values", () => {
    expect(
      capabilitiesFromProbe(
        {
          model: "qwen",
          steps: [
            { name: "streaming", ok: true },
            { name: "structured_output", ok: false, category: "bad_request" },
            { name: "json_mode", ok: true },
          ],
          supports_streaming: true,
          structured_output_transport: "json_object",
          supports_tools: false,
          tools_with_structured_output: null,
        },
        DEFAULT_CAPABILITIES_DRAFT,
      ),
    ).toEqual({
      ...DEFAULT_CAPABILITIES_DRAFT,
      structured_output_transport: "json_object",
      supports_tools: false,
    });
  });

  it("describes re-embedding progress", () => {
    expect(embeddingsStatusText({ state: "off" })).toContain("keywords");
    expect(
      embeddingsStatusText({ state: "re_embedding", pending: 12 }),
    ).toContain("12 items");
    expect(
      embeddingsStatusText({
        state: "retrying",
        pending: 3,
        error_category: "unreachable",
      }),
    ).toContain("could not be reached");
  });
});
