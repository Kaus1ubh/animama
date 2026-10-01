import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PyConfiguredModel,
  PyModelConnection,
  PyModelConnectionPreset,
} from "@animama/runtime-contracts/api-types";

import type { CredentialStatus } from "../../../../../shared/desktop-runtime";
import { queryKeys } from "@/query/keys";
import { DesktopCredentialsPanel } from "@/ui/settings/DesktopCredentialsPanel";
import { saveCredentialChanges } from "@/ui/settings/desktop-credential-state";
import { ModelConnectionsSettings } from "./ModelConnectionsSettings";

const state = vi.hoisted(() => ({
  desktop: true,
  capabilities: {} as Record<string, unknown> | undefined,
  connections: [] as unknown[],
  presets: [] as unknown[],
  reachability: {} as Record<
    string,
    { isSuccess: boolean; isError: boolean; error: unknown }
  >,
}));
const idle = vi.hoisted(() => () => ({
  mutateAsync: async () => undefined,
  reset: () => undefined,
  isPending: false,
  isSuccess: false,
  data: undefined,
}));

vi.mock("@/platform/RuntimePlatformProvider", () => ({
  useRuntimePlatform: () =>
    state.desktop
      ? {
          kind: "desktop",
          isDesktop: true,
          desktopBridge: {
            windowRole: "main",
            runtime: { status: async () => ({ state: "ready" }) },
            credentials: { list: async () => [], apply: async () => [] },
          },
        }
      : { kind: "web", isDesktop: false },
}));
vi.mock("@/app/runtime/RuntimeOwnerContext", () => ({
  useRuntimeOwnerId: () => "owner-1",
}));
vi.mock("@/hooks/useDesktopFeaturePacks", () => ({
  useDesktopFeaturePacks: () => ({ busy: false }),
}));
vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({ data: state.capabilities }),
}));
vi.mock("@/query/hooks/useModelConfiguration", () => ({
  useModelConnections: (enabled: boolean) =>
    enabled
      ? { isSuccess: true, isError: false, data: state.connections }
      : { isSuccess: false, isError: false, data: undefined },
  useModelConnectionPresets: () => ({ isSuccess: true, data: state.presets }),
  useConnectionReachability: (id: string, enabled: boolean) =>
    enabled
      ? (state.reachability[id] ?? {
          isSuccess: false,
          isError: false,
          error: null,
        })
      : { isSuccess: false, isError: false, error: null },
  useOpenRouterModels: () => ({ isSuccess: false, isError: false }),
}));
vi.mock("@/query/mutations/useModelConfiguration", () => ({
  useAddOwnerModel: idle,
  useCreateModelConnection: idle,
  useDetectModelServer: idle,
  useListAvailableModels: idle,
  useProbeModel: idle,
  useRemoveModel: idle,
  useRemoveModelConnection: idle,
  useUpdateModel: idle,
  useUpdateModelConnection: idle,
}));

const preset = (
  id: string,
  label: string,
  local: boolean,
): PyModelConnectionPreset => ({
  id,
  label,
  local,
  expects_key: !local,
  logo_provider: id,
  compatibility: {},
  timeout_seconds: 60,
});

const model = (
  id: string,
  extra: Partial<PyConfiguredModel> = {},
  capabilities: Partial<PyConfiguredModel["capabilities"]> = {},
): PyConfiguredModel => ({
  id,
  connection_id: "c",
  model: id,
  model_label: id,
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

const connection = (
  id: string,
  extra: Partial<PyModelConnection>,
): PyModelConnection => ({
  id,
  name: id,
  preset: "custom",
  source: "owner",
  compatibility: {},
  credential_state: "not_required",
  models: [],
  ...extra,
});

const builtin = connection("openai", {
  name: "OpenAI",
  preset: "openai",
  source: "builtin",
  credential_state: "missing",
  logo_provider: "openai",
  models: [
    model(
      "gpt-6-luna",
      {
        source: "builtin",
        provider_type: "OpenAIResponsesHTTPAgent",
        context_window_tokens: 400000,
      },
      { accepts: ["text", "image"], native_tool_support: ["web_search"] },
    ),
    model("gpt-6-luna-cc", { source: "builtin", hidden: true }),
  ],
});
const openrouter = connection("Router", {
  preset: "openrouter",
  base_url: "https://openrouter.ai/api/v1",
  credential_state: "configured",
  models: [model("qwen/qwen3-235b", {}, { supports_tools: true })],
});
const vllm = connection("Workstation vLLM", {
  preset: "vllm",
  base_url: "http://127.0.0.1:8000/v1",
});
const lan = connection("LAN box", {
  base_url: "http://192.168.1.20:8080/v1",
});

function client(statuses: CredentialStatus[] = []) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(
    queryKeys.desktopCredentials.available("owner-1"),
    true,
  );
  queryClient.setQueryData(
    queryKeys.desktopCredentials.statuses("owner-1"),
    statuses,
  );
  return queryClient;
}

const render = (node: ReactNode, queryClient = client()) =>
  renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );

/** Text content in document order, tags removed. */
const text = (html: string) => html.replace(/<[^>]+>/gu, " ");

function expectInOrder(html: string, parts: string[]) {
  const positions = parts.map((part) => text(html).indexOf(part));
  for (const [index, position] of positions.entries())
    expect(position, parts[index]).toBeGreaterThanOrEqual(0);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

beforeEach(() => {
  state.desktop = true;
  state.capabilities = {
    model_configuration: true,
    web_search: { configuration: true, configured: true, backend: "searxng" },
  };
  state.connections = [lan, vllm, openrouter, builtin];
  state.presets = [
    preset("ollama", "Ollama", true),
    preset("lmstudio", "LM Studio", true),
    preset("llamacpp", "llama.cpp", true),
    preset("vllm", "vLLM", true),
    preset("deepseek", "DeepSeek", false),
    preset("huggingface", "Hugging Face", false),
    preset("openrouter", "OpenRouter", false),
    preset("custom", "Custom", false),
  ];
  state.reachability = {
    "Workstation vLLM": { isSuccess: true, isError: false, error: null },
    "LAN box": {
      isSuccess: false,
      isError: true,
      error: { detail: { code: "unreachable" } },
    },
  };
});

describe("Models connections by where models run", () => {
  it("offers Cloud and Local tabs with proper tab roles", () => {
    const html = render(<ModelConnectionsSettings disabled={false} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Where models run"');
    expect(html.match(/role="tab"/gu)).toHaveLength(2);
    expectInOrder(html, ["Cloud", "Local"]);
    expect(html).not.toMatch(/>(Ollama|LM Studio|vLLM)<\/button>/u);
  });

  it("lists connected cloud providers first, then Add entries", () => {
    const html = render(<ModelConnectionsSettings disabled={false} />);
    expectInOrder(html, [
      "OpenAI",
      "Recommended",
      "Key missing",
      "Router",
      "Key set",
      "Add a provider",
      "DeepSeek",
      "Hugging Face",
      "Custom",
    ]);
    expect(html).toContain('aria-label="Add DeepSeek"');
    expect(html).toContain('aria-label="Add a custom server"');
    // Connected OpenRouter and the always-connected OpenAI have no Add entry.
    expect(html).not.toContain('aria-label="Add OpenRouter"');
    expect(html).not.toContain('aria-label="Add OpenAI"');
    // Local connections stay off the Cloud tab.
    expect(html).not.toContain("Workstation vLLM");
    expect(html).not.toContain("LAN box");
  });

  it("shows capability chips instead of API tags, and keeps hidden rows reachable", () => {
    const html = render(<ModelConnectionsSettings disabled={false} />);
    const chips = [
      ...html.matchAll(
        /<li[^>]*title="[^"]*"><span aria-hidden="true">([^<]+)/gu,
      ),
    ].map((match) => match[1]);
    expect(chips).toEqual([
      "Tools",
      "400K",
      "Built-in search",
      "Vision",
      "Tools",
      "128K",
      "App search",
    ]);
    expect(text(html)).not.toMatch(/\b(Responses|Completions)\b/u);
    // The hidden Chat Completions row waits behind a toggle.
    expect(html).not.toContain("gpt-6-luna-cc");
    expect(html).toContain("Show 1 hidden model");
  });

  it("lists local servers with their reachability", () => {
    const html = render(
      <ModelConnectionsSettings disabled={false} defaultTab="local" />,
    );
    expectInOrder(html, [
      "Workstation vLLM",
      "Running at 127.0.0.1:8000",
      "LAN box",
      "Not reachable",
      "Add a provider",
      "Ollama",
      "LM Studio",
      "llama.cpp",
      "Custom",
    ]);
    expect(html).toMatch(/role="status"[^>]*>Running at 127\.0\.0\.1:8000/u);
    expect(html).not.toContain('aria-label="Add vLLM"');
    expect(html).not.toContain("Router");
  });

  it("puts the OpenAI key field on the OpenAI card on desktop", () => {
    const html = render(<ModelConnectionsSettings disabled={false} />);
    const card = html.slice(0, html.indexOf("Router"));
    expect(card).toMatch(/<label[^>]*>OpenAI<\/label>/u);
    expect(card).toContain('type="password"');
    expect(card).not.toMatch(/<label[^>]*>ElevenLabs<\/label>/u);
  });

  it("shares the OpenAI key state with App Settings → API Keys", async () => {
    const unset: CredentialStatus[] = [
      {
        provider: "openai",
        configured: false,
        updatedAt: null,
        restartRequired: false,
      },
    ];
    const queryClient = client(unset);
    const both = () =>
      render(
        <>
          <ModelConnectionsSettings disabled={false} />
          <DesktopCredentialsPanel showTitle={false} />
        </>,
        queryClient,
      );
    const statuses = (html: string) =>
      [...html.matchAll(/>OpenAI<\/label><p[^>]*>([^<]+)<\/p>/gu)].map(
        (match) => match[1],
      );
    expect(statuses(both())).toEqual(["Not set", "Not set"]);
    const saved: CredentialStatus[] = [{ ...unset[0], configured: true }];
    await saveCredentialChanges(
      queryClient,
      "owner-1",
      { list: async () => saved, apply: async () => saved },
      [{ provider: "openai", value: "fixture-key" }],
    );
    expect(statuses(both())).toEqual(["Configured", "Configured"]);
  });

  it("explains the environment key on self-hosted web", () => {
    state.desktop = false;
    const html = render(<ModelConnectionsSettings disabled={false} />);
    expect(html).toContain("OPENAI_API_KEY");
    expect(html).not.toContain('type="password"');
  });

  it("renders nothing in the hosted composition", () => {
    state.capabilities = { model_configuration: false };
    expect(render(<ModelConnectionsSettings disabled={false} />)).toBe("");
    state.capabilities = undefined;
    expect(render(<ModelConnectionsSettings disabled={false} />)).toBe("");
  });
});
