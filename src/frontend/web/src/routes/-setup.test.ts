import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type {
  PyModelConnection,
  PyModelConnectionDetection,
  PyModelProviderCatalogItem,
} from "@animama/runtime-contracts/api-types";
import {
  emptySetupDraft,
  type SetupDraft,
} from "@/app/local-runtime/setup-draft";
import { Route } from "@/routes/setup";
import { normalizeLocalDisplayName } from "@/lib/user-profile/display-name";
import {
  adjacentSetupStep,
  detectedModelsToAdd,
  onboardingInput,
  openAiDefaultModel,
  ownerModelChoices,
  resolveSetupTtsProvider,
  setupStepPosition,
  setupTtsOptions,
  setupTtsPatch,
} from "@/app/local-runtime/setup/setup-state";

// Rendering is static here; scripts/setup-downloads.browser.test.mjs drives
// navigation, focus, the unsaved-key prompt and the Finish payload in a browser.
const OPENAI_MODEL = "OpenAIResponsesHTTPAgent:gpt-6-luna";
const fixture = vi.hoisted(() => ({
  completeOnboarding: vi.fn(),
  draft: null as SetupDraft | null,
  capabilities: {
    isPending: false,
    isError: false,
    data: { model_configuration: true } as Record<string, unknown>,
  },
  connections: [] as unknown[],
  providers: [] as unknown[],
}));
vi.mock("@web/app/local-runtime/LocalRuntimeProvider", () => ({
  useLocalRuntime: () => ({
    state: {
      status: "ready",
      firstRunComplete: false,
      principalId: "test-owner",
    },
    completeOnboarding: fixture.completeOnboarding,
  }),
}));
vi.mock("@/app/local-runtime/setup-draft", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/local-runtime/setup-draft")>();
  return {
    ...actual,
    readSetupDraft: () => fixture.draft ?? actual.emptySetupDraft(),
  };
});
vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => fixture.capabilities,
}));
vi.mock("@/query/hooks/useModelProviders", () => ({
  useModelProviders: () => ({
    data: fixture.providers,
    isSuccess: true,
    isError: false,
    isFetching: false,
  }),
}));
vi.mock("@/query/hooks/useModelConfiguration", () => {
  const ok = (data: unknown) => ({
    data,
    isSuccess: true,
    isError: false,
    isFetching: false,
    isFetched: true,
  });
  return {
    useModelConnections: () => ok(fixture.connections),
    useModelConnectionPresets: () => ok([]),
    useModelRoles: () =>
      ok({ roles: [{ role: "chat", model_provider_id: OPENAI_MODEL }] }),
  };
});
vi.mock("@/ui/settings/OfflineSpeechDownloads", () => {
  const asset = (id: string, size: number) => ({
    id,
    status: "not_installed",
    size_bytes: size,
    required_free_bytes: size,
  });
  return {
    assetFailureText: () => "",
    OfflineSpeechDownloads: () => null,
    useOfflineSpeechDownloads: () => ({
      cpu: asset("parakeet-stt", 631_000_000),
      gpu: asset("parakeet-stt-webgpu", 1_200_000_000),
      freeBytes: null,
      gpuSupport: "available",
      pending: false,
      onChange: () => {},
    }),
  };
});
vi.mock("@/ui/settings/DesktopCredentialsPanel", () => ({
  DesktopCredentialsPanel: ({ providers }: { providers: string[] }) =>
    createElement("div", { "data-key-panel": providers.join(",") }),
  useDesktopCredentialsAvailable: () => true,
  useDesktopCredentialConfigured: () => false,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: ReactNode;
    className?: string;
  }) => createElement("a", { href: to, className }, children),
}));

function renderSetup(draft: Partial<SetupDraft> | null = null): string {
  fixture.draft = draft ? { ...emptySetupDraft(), ...draft } : null;
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(Route.options.component!),
    ),
  );
}

const welcomeDone = { displayName: "Ada", adultConfirmed: true };

const builtinConnection = {
  id: "builtin-openai",
  name: "OpenAI",
  preset: "openai",
  source: "builtin",
  base_url: null,
  credential_state: "configured",
  models: [],
} as unknown as PyModelConnection;
const ollama = {
  id: "conn-ollama",
  name: "Ollama",
  preset: "ollama",
  source: "owner",
  base_url: "http://127.0.0.1:11434/v1/",
  credential_state: "not_required",
  models: [{ model: "qwen3:8b" }],
} as unknown as PyModelConnection;
const deepseek = {
  id: "conn-deepseek",
  name: "DeepSeek",
  preset: "deepseek",
  source: "owner",
  base_url: "https://api.deepseek.com/v1",
  credential_state: "configured",
  models: [],
} as unknown as PyModelConnection;
const item = (
  id: string,
  connection: PyModelConnection,
  patch: Partial<PyModelProviderCatalogItem> = {},
): PyModelProviderCatalogItem =>
  ({
    id,
    model: id.split(":").at(-1),
    model_label: id.split(":").at(-1),
    model_provider: "OpenAIHTTPAgent",
    api_standard: "chat_completions",
    connection_id: connection.id,
    connection_name: connection.name,
    source: connection.source === "builtin" ? "builtin" : "owner",
    model_kind: "chat",
    hidden: false,
    supports_streaming: true,
    context_window_tokens: 8192,
    ...patch,
  }) as PyModelProviderCatalogItem;
const catalog = [
  item("OpenAIHTTPAgent:gpt-6-luna", builtinConnection),
  item("OpenAIResponsesHTTPAgent:gpt-6-mini", builtinConnection, {
    model_provider: "OpenAIResponsesHTTPAgent",
    api_standard: "responses",
  }),
  item(OPENAI_MODEL, builtinConnection, {
    model_provider: "OpenAIResponsesHTTPAgent",
    api_standard: "responses",
    model_label: "GPT-6 Luna",
  }),
  item("OpenAIHTTPAgent:conn-ollama:qwen3:8b", ollama, {
    model: "qwen3:8b",
    model_label: "qwen3:8b",
  }),
  item("OpenAIHTTPAgent:conn-ollama:hidden", ollama, { hidden: true }),
  item("OpenAIHTTPAgent:conn-ollama:no-context", ollama, {
    context_window_tokens: null,
  }),
  item("OpenAIHTTPAgent:conn-deepseek:deepseek-chat", deepseek),
];

describe("local first-run setup", () => {
  it("normalizes the required name consistently for setup and personalization", () => {
    expect(normalizeLocalDisplayName("  Ada   Lovelace  ")).toBe(
      "Ada Lovelace",
    );
    expect(normalizeLocalDisplayName("x".repeat(80))).toBe("x".repeat(80));
  });

  it.each(["", "   ", "\t\n", " ", "x".repeat(81)])(
    "rejects an unsavable name: %j",
    (value) => {
      expect(normalizeLocalDisplayName(value)).toBeNull();
    },
  );

  it("starts on Welcome, which alone gates on the name and explicit 18+ confirmation", () => {
    const html = renderSetup();
    expect(html).toContain("Step 1 of 3");
    expect(html).toMatch(/<li aria-current="step"[^>]*>Welcome<\/li>/u);
    expect(html).toMatch(/<input[^>]*id="local-display-name"[^>]*required=""/u);
    expect(html).toMatch(
      /<button[^>]*type="submit"[^>]*disabled=""[^>]*>Continue<\/button>/u,
    );
    expect(html).toMatch(
      /<input[^>]*type="checkbox"[^>]*name="adult-confirmed"/u,
    );
    expect(html).not.toContain("checked=");
    expect(html).toContain("I am 18 or older");
    expect(html).toContain("I&#x27;m under 18");
    expect(html).not.toContain("Skip for now");
    expect(html).not.toContain("Back");
    // Keys and downloads moved to later steps.
    expect(html).not.toContain("data-key-panel");
    expect(html).not.toContain("Download CPU model");
    expect(fixture.completeOnboarding).not.toHaveBeenCalled();
  });

  it("keeps the AI and minors notices and the safety link unchanged", () => {
    const html = renderSetup();
    expect(html).toContain("Animas are AI companions, not people.");
    expect(html).toContain("may not be suitable for some minors");
    expect(html).not.toMatch(/professional help/iu);
    expect(html).toContain('href="/safety"');
    expect(html).toContain("Safety and crisis protocol");
  });

  it("enables Continue once both Welcome answers are present", () => {
    const html = renderSetup({ displayName: "Ada", adultConfirmed: true });
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Continue<\/button>/u);
    expect(html).not.toMatch(/type="submit"[^>]*disabled=""/u);
  });

  it("offers Cloud | Local and provider tabs on the AI step, with the OpenAI key and Skip", () => {
    fixture.connections = [builtinConnection];
    fixture.providers = catalog;
    const html = renderSetup({
      ...welcomeDone,
      step: "ai",
      chatModelId: OPENAI_MODEL,
    });
    expect(html).toContain("Step 2 of 3");
    expect(html).toMatch(/<li aria-current="step"[^>]*>AI<\/li>/u);
    // Cloud carries the Recommended tag; the step no longer lists models.
    expect(html).toMatch(
      /role="tab"[^>]*><span[^>]*>Cloud<span[^>]*>Recommended<\/span>/u,
    );
    expect(html).toMatch(/role="tab"[^>]*>Local</u);
    expect(html).not.toContain("Model for new Animas");
    expect(html).not.toContain("App Settings → Models");
    expect(html).toContain('data-key-panel="openai"');
    expect(html).toContain('aria-label="Cloud providers"');
    expect(html).toContain('aria-label="Local providers"');
    for (const provider of ["DeepSeek", "OpenRouter", "Ollama", "vLLM"])
      expect(html).toMatch(
        new RegExp(`role="tab"[^>]*><span[^>]*>${provider}`, "u"),
      );
    // OpenAI (key set) opens first and is marked connected.
    expect(html).toMatch(
      /role="tab" aria-selected="true"[^>]*><span[^>]*>OpenAI<span aria-hidden="true"[^>]*><\/span><span class="sr-only"> \(connected\)/u,
    );
    expect(html).toMatch(/<button[^>]*>Back<\/button>/u);
    expect(html).toMatch(/<button[^>]*>Skip for now<\/button>/u);
    expect(html).toMatch(/<button[^>]*>Continue<\/button>/u);
    expect(html).not.toContain("Finish");
  });

  it("shows no model choice on the hosted composition's AI step", () => {
    fixture.capabilities = {
      isPending: false,
      isError: false,
      data: { model_configuration: false },
    };
    try {
      const html = renderSetup({ ...welcomeDone, step: "ai" });
      expect(html).toContain("provides its own models");
      expect(html).not.toContain('role="tab"');
      expect(html).not.toContain('role="radio"');
      expect(html).toMatch(/<button[^>]*>Continue<\/button>/u);
    } finally {
      fixture.capabilities = {
        isPending: false,
        isError: false,
        data: { model_configuration: true },
      };
    }
  });

  it("offers speech downloads and Text-to-Speech on the Voice step, which finishes setup", () => {
    const html = renderSetup({
      ...welcomeDone,
      step: "voice",
      ttsProvider: "elevenlabs",
    });
    expect(html).toContain("Step 3 of 3");
    expect(html).toMatch(/<li aria-current="step"[^>]*>Voice<\/li>/u);
    expect(html).toContain("Parakeet (CPU");
    expect(html).toContain("Parakeet (GPU");
    // Text-to-Speech is on by default: provider tabs, no toggle.
    expect(html).not.toContain("Enable Text-to-Speech");
    expect(html).not.toContain("optional");
    expect(html).not.toContain("attribution");
    expect(html).toContain("PocketTTS (built-in)");
    // Each local model links to its public source.
    expect(html).toContain(
      'href="https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2"',
    );
    expect(html).toContain('href="https://github.com/kyutai-labs/pocket-tts"');
    expect(html).toContain("Works on any computer.");
    expect(html).toMatch(
      /<button[^>]*aria-selected="true"[^>]*>ElevenLabs<\/button>/u,
    );
    expect(html).toContain('data-key-panel="elevenlabs"');
    expect(html).toMatch(/<button[^>]*>Finish<\/button>/u);
    expect(html).toMatch(/<button[^>]*>Skip for now<\/button>/u);
    expect(html).not.toMatch(/reload/iu);
  });
});

describe("setup step logic", () => {
  it("orders the three steps", () => {
    expect(setupStepPosition("ai")).toBe("Step 2 of 3");
    expect(adjacentSetupStep("welcome", 1)).toBe("ai");
    expect(adjacentSetupStep("ai", -1)).toBe("welcome");
    expect(adjacentSetupStep("voice", 1)).toBeNull();
  });

  it("sends the chosen model only when one was chosen and models are configurable", () => {
    const draft = { adultConfirmed: true, chatModelId: OPENAI_MODEL };
    expect(onboardingInput(draft, "Ada", true)).toEqual({
      displayName: "Ada",
      adultConfirmed: true,
      chatModelProviderId: OPENAI_MODEL,
    });
    expect(
      onboardingInput({ ...draft, chatModelId: null }, "Ada", true),
    ).toEqual({ displayName: "Ada", adultConfirmed: true });
    expect(onboardingInput(draft, "Ada", false)).toEqual({
      displayName: "Ada",
      adultConfirmed: true,
    });
  });

  it("writes the Text-to-Speech provider only when chosen, keeping it on", () => {
    const saved = { tts_enabled: true, tts_provider: "elevenlabs" as const };
    expect(setupTtsPatch({ ttsProvider: null })).toBeNull();
    expect(resolveSetupTtsProvider({ ttsProvider: null }, saved)).toBe(
      "elevenlabs",
    );
    expect(
      resolveSetupTtsProvider(
        { ttsProvider: null },
        { tts_provider: "browser" },
      ),
    ).toBe("pocket_tts");
    expect(setupTtsPatch({ ttsProvider: "pocket_tts" })).toEqual({
      tts_enabled: true,
      tts_provider: "pocket_tts",
    });
  });

  it("offers built-in voices and ElevenLabs with App Settings' availability", () => {
    const options = setupTtsOptions([
      {
        id: "pocket_tts",
        label: "PocketTTS",
        description: "",
        disabled: false,
      },
      {
        id: "elevenlabs",
        label: "ElevenLabs",
        description: "",
        disabled: true,
        reason: "WebSocket is not supported in this browser.",
      },
    ]);
    expect(
      options.map((option) => [option.id, option.label, option.disabled]),
    ).toEqual([
      ["pocket_tts", "PocketTTS (built-in)", false],
      ["elevenlabs", "ElevenLabs", true],
    ]);
    expect(options[1].reason).toContain("WebSocket");
  });

  it("chooses OpenAI's default Responses model and lists owner models by location", () => {
    const connections = [builtinConnection, ollama, deepseek];
    expect(openAiDefaultModel(catalog, connections, OPENAI_MODEL)?.id).toBe(
      OPENAI_MODEL,
    );
    expect(openAiDefaultModel(catalog, connections, null)?.id).toBe(
      "OpenAIResponsesHTTPAgent:gpt-6-mini",
    );
    expect(openAiDefaultModel([], connections, OPENAI_MODEL)).toBeNull();
    expect(ownerModelChoices(catalog, connections, "local")).toEqual([
      {
        id: "OpenAIHTTPAgent:conn-ollama:qwen3:8b",
        label: "qwen3:8b",
        connectionName: "Ollama",
      },
    ]);
    expect(
      ownerModelChoices(catalog, connections, "cloud").map(
        (choice) => choice.id,
      ),
    ).toEqual(["OpenAIHTTPAgent:conn-deepseek:deepseek-chat"]);
  });

  it("offers to add only detected models not yet added at that address", () => {
    const detection = {
      preset: "ollama",
      base_url: "http://127.0.0.1:11434/v1",
      reachable: true,
      models: ["qwen3:8b", "llama3.2"],
    } as PyModelConnectionDetection;
    expect(detectedModelsToAdd(detection, [ollama])).toEqual(["llama3.2"]);
    expect(detectedModelsToAdd(detection, [])).toEqual([
      "qwen3:8b",
      "llama3.2",
    ]);
  });
});
