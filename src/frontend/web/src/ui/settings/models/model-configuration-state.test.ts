import { describe, expect, it } from "vitest";
import type {
  PyConfiguredModel,
  PyModelProviderCatalogItem,
} from "@animama/runtime-contracts/api-types";

import { availableSettingsSections } from "@/ui/settings/settings-search";
import {
  DEFAULT_CAPABILITIES_DRAFT,
  MODEL_LOCATION_PROVIDERS,
  MODEL_LOCATION_TABS,
  capabilitiesFromProbe,
  connectionLocation,
  connectionStatusText,
  detectionMessage,
  embeddingsStatusText,
  formatContextWindow,
  isPrivateNetworkUrl,
  keyWouldTravelInsecurely,
  locationProviderGroups,
  modelApiLabel,
  modelCapabilityChips,
  modelConfigurationErrorCode,
  modelConfigurationErrorMessage,
  modelInUseUsage,
  modelSettingsAvailability,
  removalConsequences,
  removalUsageSummary,
  roleCandidates,
} from "./model-configuration-state";
import {
  alternateModelIds,
  modelConnectionLabel,
  modelDisplayName,
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
    api_standard: "chat_completions",
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
    // The Chat default also needs a model direct chat can send to.
    expect(
      roleCandidates(
        [...items, row("unsupported", { api_standard: null })],
        "chat",
      ).map((item) => item.id),
    ).toEqual(["tools", "no-tools", "builtin-no-window"]);
    // A hidden model stays listed while it is the role's current choice.
    expect(
      roleCandidates(items, "utility", "hidden").map((item) => item.id),
    ).toContain("hidden");
  });

  it("groups the built-in OpenAI connection's models under one name", () => {
    const builtin = row("gpt-6-luna", {
      connection_id: "openai",
      connection_name: "OpenAI",
      provider_label: "OpenAI Responses HTTP",
      model_provider: "OpenAIResponsesHTTPAgent",
    });
    const owner = row("gpt-6.1-luna", {
      connection_id: "openai",
      connection_name: "OpenAI",
      provider_label: "OpenAI",
      model_provider: "OpenAIResponsesHTTPAgent",
    });
    expect(modelConnectionLabel(builtin)).toBe("OpenAI");
    expect(modelConnectionLabel(owner)).toBe("OpenAI");
    // Pickers never name the API; the app picks it.
    expect(modelOptionDetail(owner)).toBe("OpenAI");
    expect(modelOptionLabel(builtin)).toBe("OpenAI: gpt-6-luna");
    expect(
      modelOptionLabel({ ...builtin, model_provider: "OpenAIHTTPAgent" }),
    ).toBe("OpenAI: gpt-6-luna");
    const local = row("qwen3:8b", {
      connection_id: "c_0123456789ab",
      connection_name: "Ollama",
    });
    expect(modelOptionDetail(local)).toBe("Ollama");
  });

  it("marks only the non-Responses twin of a visible duplicate name as alternate", () => {
    const responses = row("gpt-6-luna", {
      connection_id: "openai",
      model_provider: "OpenAIResponsesHTTPAgent",
    });
    const completions = row("gpt-6-luna:cc", {
      model: "gpt-6-luna",
      model_label: "gpt-6-luna",
      connection_id: "openai",
      model_provider: "OpenAIHTTPAgent",
    });
    const elsewhere = row("gpt-6-luna:or", {
      model: "gpt-6-luna",
      model_label: "gpt-6-luna",
      connection_id: "c_router",
    });
    // Order does not matter; the Responses row keeps the plain name.
    expect([...alternateModelIds([completions, responses, elsewhere])]).toEqual(
      ["gpt-6-luna:cc"],
    );
    // A hidden twin left out of the list renames nothing.
    expect(alternateModelIds([responses, elsewhere]).size).toBe(0);
    // Configured models name the API in provider_type.
    expect([
      ...alternateModelIds([
        {
          ...completions,
          model_provider: undefined,
          provider_type: "OpenAIHTTPAgent",
        },
        {
          ...responses,
          model_provider: undefined,
          provider_type: "OpenAIResponsesHTTPAgent",
        },
      ]),
    ]).toEqual(["gpt-6-luna:cc"]);
    // Embedding rows never take part.
    expect(
      alternateModelIds([
        responses,
        { ...completions, model_kind: "embedding" },
      ]).size,
    ).toBe(0);
    expect(modelOptionLabel(completions, true)).toBe(
      "Ollama: gpt-6-luna (alternate)",
    );
    expect(modelDisplayName(completions, true)).toBe("gpt-6-luna (alternate)");
    expect(modelDisplayName(completions, true)).not.toMatch(
      /Responses|Completions/u,
    );
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
      "Used by Mira and Luna, and as the Compaction model.",
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

describe("detectionMessage", () => {
  const base = { preset: "ollama", base_url: "http://127.0.0.1:11434/v1" };

  it("counts the models found at the address", () => {
    expect(
      detectionMessage(
        { ...base, reachable: true, models: ["qwen3:8b", "gemma3"] },
        "Ollama",
      ),
    ).toBe("Found 2 models at http://127.0.0.1:11434/v1.");
    expect(
      detectionMessage({ ...base, reachable: true, models: ["a"] }, "Ollama"),
    ).toBe("Found 1 model at http://127.0.0.1:11434/v1.");
  });

  it("names the server to start when nothing answers", () => {
    expect(
      detectionMessage({ ...base, reachable: false, models: [] }, "Ollama"),
    ).toBe(
      "Nothing is running at http://127.0.0.1:11434/v1. Start Ollama and try again.",
    );
  });
});

describe("Cloud and Local tabs", () => {
  const owner = (preset: string, base_url: string | null = null) => ({
    source: "owner" as const,
    preset,
    base_url,
  });

  it("offers the planned providers on each tab, OpenAI recommended", () => {
    expect(MODEL_LOCATION_TABS.map((tab) => tab.label)).toEqual([
      "Cloud",
      "Local",
    ]);
    expect(MODEL_LOCATION_PROVIDERS.cloud.map((entry) => entry.label)).toEqual([
      "OpenAI",
      "DeepSeek",
      "Hugging Face",
      "OpenRouter",
      "Custom",
    ]);
    expect(MODEL_LOCATION_PROVIDERS.local.map((entry) => entry.label)).toEqual([
      "Ollama",
      "LM Studio",
      "llama.cpp",
      "vLLM",
      "Custom",
    ]);
    expect(
      MODEL_LOCATION_PROVIDERS.cloud.filter((entry) => entry.recommended),
    ).toEqual([expect.objectContaining({ id: "openai" })]);
  });

  it("puts the built-in connection and cloud presets on Cloud, local servers on Local", () => {
    expect(
      connectionLocation({ source: "builtin", preset: "openai", base_url: "" }),
    ).toBe("cloud");
    for (const preset of ["deepseek", "huggingface", "openrouter", "unknown"])
      expect(connectionLocation(owner(preset))).toBe("cloud");
    for (const preset of ["ollama", "lmstudio", "llamacpp", "vllm"])
      // Even when pointed at another computer, a local server type stays Local.
      expect(
        connectionLocation(owner(preset, "https://gpu.example.test/v1")),
      ).toBe("local");
  });

  it.each([
    ["http://127.0.0.1:8080/v1", "local"],
    ["http://localhost:1234/v1", "local"],
    ["http://ollama.localhost/v1", "local"],
    ["http://host.docker.internal:8000/v1", "local"],
    ["http://[::1]:8080/v1", "local"],
    ["http://192.168.1.20:11434/v1", "local"],
    ["http://10.0.0.5/v1", "local"],
    ["http://172.20.1.1:8000/v1", "local"],
    ["http://gpu-box.local:8000/v1", "local"],
    ["http://[fd12::1]:8000/v1", "local"],
    ["192.168.1.20:8000/v1", "local"],
    ["http://gpu-box:8000/v1", "local"],
    ["http://nas.lan:8000/v1", "local"],
    ["http://llm.home.arpa/v1", "local"],
    ["http://models.corp.internal/v1", "local"],
    ["http://100.64.0.1:11434/v1", "local"],
    ["http://100.127.255.254/v1", "local"],
    ["http://gpu-box.tail1234.ts.net:8000/v1", "local"],
    ["http://100.128.0.1/v1", "cloud"],
    ["https://lan.example.com/v1", "cloud"],
    ["https://internal.example.com/v1", "cloud"],
    ["http://172.32.0.1/v1", "cloud"],
    ["https://api.together.xyz/v1", "cloud"],
    ["https://8.8.8.8/v1", "cloud"],
    ["", "cloud"],
  ])("places a custom connection at %s on %s", (baseUrl, location) => {
    expect(connectionLocation(owner("custom", baseUrl))).toBe(location);
    expect(isPrivateNetworkUrl(baseUrl)).toBe(location === "local");
  });

  it("lists connected providers first, then the rest in tab order", () => {
    const connections = [
      { id: "lan", ...owner("custom", "http://192.168.1.4:8000/v1") },
      { id: "or", ...owner("openrouter", "https://openrouter.ai/api/v1") },
      { id: "builtin", source: "builtin" as const, preset: "openai" },
      { id: "vllm", ...owner("vllm", "http://127.0.0.1:8000/v1") },
      { id: "remote", ...owner("custom", "https://api.example.test/v1") },
    ];
    const cloud = locationProviderGroups(connections, "cloud");
    expect(cloud.map((group) => group.entry.id)).toEqual([
      "openai",
      "openrouter",
      "custom-cloud",
      "deepseek",
      "huggingface",
    ]);
    expect(cloud[0].connections.map((item) => item.id)).toEqual(["builtin"]);
    expect(cloud[2].connections.map((item) => item.id)).toEqual(["remote"]);
    expect(cloud[3].connections).toEqual([]);
    const local = locationProviderGroups(connections, "local");
    expect(local.map((group) => group.entry.id)).toEqual([
      "vllm",
      "custom-local",
      "ollama",
      "lmstudio",
      "llamacpp",
    ]);
    expect(local[1].connections.map((item) => item.id)).toEqual(["lan"]);
  });

  it("shows key state on Cloud and reachability on Local", () => {
    const cloud = {
      ...owner("deepseek"),
      credential_state: "missing" as const,
    };
    expect(connectionStatusText(cloud)).toBe("Key missing");
    expect(
      connectionStatusText({ ...cloud, credential_state: "configured" }),
    ).toBe("Key set");
    const local = {
      ...owner("ollama", "http://127.0.0.1:11434/v1"),
      credential_state: "not_required" as const,
    };
    expect(connectionStatusText(local)).toBe("Checking…");
    expect(connectionStatusText(local, { state: "reachable" })).toBe(
      "Running at 127.0.0.1:11434",
    );
    expect(
      connectionStatusText(local, { state: "failed", category: "unreachable" }),
    ).toBe("Not reachable");
    expect(
      connectionStatusText(local, { state: "failed", category: "timeout" }),
    ).toBe("Not reachable");
    expect(
      connectionStatusText(local, {
        state: "failed",
        category: "credential_missing",
      }),
    ).toBe("Key missing");
    expect(
      modelConfigurationErrorCode({ detail: { code: "unreachable" } }),
    ).toBe("unreachable");
    expect(modelConfigurationErrorCode(new Error("x"))).toBeNull();
  });
});

describe("model row chips", () => {
  const model = (
    extra: Partial<PyConfiguredModel> = {},
    capabilities: Partial<PyConfiguredModel["capabilities"]> = {},
  ): PyConfiguredModel => ({
    id: "m",
    connection_id: "c",
    model: "m",
    model_label: "m",
    model_kind: "chat",
    provider_type: "OpenAIHTTPAgent",
    source: "owner",
    hidden: false,
    allow_memory_writes: true,
    context_window_tokens: 131072,
    ...extra,
    capabilities: {
      accepts: ["text"],
      supports_streaming: true,
      supports_tools: true,
      tools_with_structured_output: true,
      ...capabilities,
    },
  });
  const search = {
    configuration: true,
    configured: true,
    backend: "searxng" as const,
    credential_state: "not_required" as const,
  };
  const labels = (
    item: PyConfiguredModel,
    capability?: Parameters<typeof modelCapabilityChips>[1],
  ) => modelCapabilityChips(item, capability).map((chip) => chip.label);

  it("shows Tools, Context, Web search and Vision in order, never the API", () => {
    expect(labels(model({}, { accepts: ["text", "image"] }), search)).toEqual([
      "Tools",
      "128K",
      "App search",
      "Vision",
    ]);
    const responses = model(
      {
        provider_type: "OpenAIResponsesHTTPAgent",
        context_window_tokens: 400000,
      },
      { native_tool_support: ["web_search", "apply_patch"] },
    );
    expect(labels(responses, null)).toEqual([
      "Tools",
      "400K",
      "Built-in search",
    ]);
    for (const item of [model(), responses])
      expect(labels(item, search).join(" ")).not.toMatch(
        /Responses|Completions/u,
      );
  });

  it("offers app search only to tool-calling models with a ready search service", () => {
    expect(labels(model({}, { supports_tools: false }), search)).toEqual([
      "128K",
    ]);
    expect(labels(model(), { ...search, configured: false })).toEqual([
      "Tools",
      "128K",
    ]);
    expect(
      labels(model(), {
        ...search,
        backend: "brave",
        credential_state: "missing",
      }),
    ).toEqual(["Tools", "128K"]);
    // Built-in search needs the Responses API, as the backend requires.
    expect(
      labels(model({}, { native_tool_support: ["web_search"] }), null),
    ).toEqual(["Tools", "128K"]);
  });

  it("labels embedding models by kind and omits an unknown context window", () => {
    expect(labels(model({ model_kind: "embedding" }), search)).toEqual([
      "Embeddings",
    ]);
    expect(labels(model({ context_window_tokens: null }), null)).toEqual([
      "Tools",
    ]);
  });

  it("formats context windows", () => {
    expect(formatContextWindow(8192)).toBe("8K");
    expect(formatContextWindow(128000)).toBe("128K");
    expect(formatContextWindow(200000)).toBe("200K");
    expect(formatContextWindow(1048576)).toBe("1M");
    expect(formatContextWindow(1050000)).toBe("1.1M");
    expect(formatContextWindow(512)).toBe("512");
  });

  it("names the API only for the Info panel", () => {
    expect(
      modelApiLabel(model({ provider_type: "OpenAIResponsesHTTPAgent" })),
    ).toBe("Responses");
    expect(modelApiLabel(model())).toBe("Chat Completions");
  });
});

describe("Models in App Settings by composition", () => {
  const entries = (caps: Parameters<typeof modelSettingsAvailability>[0]) => {
    const visible = modelSettingsAvailability(caps);
    return [
      { section: "General" as const },
      ...(visible.modelConfiguration ? [{ section: "Models" as const }] : []),
      ...(visible.webSearchConfiguration
        ? [{ section: "Models" as const }]
        : []),
    ];
  };

  it("hides Models in the hosted composition and shows it locally", () => {
    const sections = ["General", "Models"] as const;
    expect(
      availableSettingsSections(
        sections,
        entries({ model_configuration: false }),
      ),
    ).toEqual(["General"]);
    expect(availableSettingsSections(sections, entries({}))).toEqual([
      "General",
    ]);
    expect(availableSettingsSections(sections, entries(undefined))).toEqual([
      "General",
    ]);
    expect(
      availableSettingsSections(
        sections,
        entries({
          model_configuration: true,
          web_search: { configuration: true },
        }),
      ),
    ).toEqual(["General", "Models"]);
  });
});
