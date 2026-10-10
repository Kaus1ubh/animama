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
  useRuntimeCacheKey: () => "owner-1",
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
const anthropic = connection("anthropic", {
  name: "Anthropic",
  preset: "anthropic",
  source: "builtin",
  credential_state: "missing",
  logo_provider: "anthropic",
  models: [
    model(
      "AnthropicMessagesHTTPAgent:claude-haiku-5-5",
      {
        connection_id: "anthropic",
        model: "claude-haiku-5-5",
        model_label: "Claude Haiku 5.5",
        source: "builtin",
        provider_type: "AnthropicMessagesHTTPAgent",
        context_window_tokens: 1000000,
        early_compaction: true,
      },
      { accepts: ["text", "image"], native_tool_support: ["web_search"] },
    ),
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
  state.connections = [lan, vllm, openrouter, anthropic, builtin];
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

/** One tab panel's markup, found by its tab value. */
function panel(html: string, value: string): string {
  const open = new RegExp(
    `<div[^>]* id="[^"]*-content-${value}"[^>]*>`,
    "u",
  ).exec(html);
  if (!open) throw new Error(`No ${value} panel`);
  const tags = /<\/?div\b[^>]*>/gu;
  tags.lastIndex = open.index + open[0].length;
  let depth = 1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(open.index, tag.index);
  }
  throw new Error(`Unclosed ${value} panel`);
}

/** Whether a tab with this accessible text is the selected one. */
const selectedTab = (html: string, name: string) =>
  new RegExp(
    `<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>(?:<[^>]+>)*${name}\\b`,
    "u",
  ).test(html);

describe("Models connections by where models run", () => {
  it("offers Cloud and Local tabs, each with a row of provider tabs", () => {
    const html = render(<ModelConnectionsSettings disabled={false} />);
    expect(html).toContain('aria-label="Where models run"');
    expect(html).toContain('aria-label="Cloud providers"');
    expect(html).toContain('aria-label="Local providers"');
    expect(html.match(/role="tab"/gu)).toHaveLength(13);
    const cloud = panel(html, "cloud");
    expectInOrder(cloud, [
      "OpenAI",
      "Anthropic",
      "DeepSeek",
      "Hugging Face",
      "OpenRouter",
      "Custom",
    ]);
    expectInOrder(panel(html, "local"), [
      "Ollama",
      "LM Studio",
      "llama.cpp",
      "vLLM",
      "Custom",
    ]);
  });

  it("opens on the first connected provider and marks connected tabs", () => {
    const html = render(<ModelConnectionsSettings disabled={false} />);
    // OpenAI's key is missing, so OpenRouter is the first connected provider.
    expect(selectedTab(html, "Cloud")).toBe(true);
    expect(selectedTab(html, "OpenRouter")).toBe(true);
    expect(selectedTab(html, "vLLM")).toBe(true);
    const connected = [
      ...html.matchAll(
        /role="tab"[^>]*>(?:<span[^>]*>)?([^<]+)<span aria-hidden="true"[^>]*><\/span><span class="sr-only"> \(connected\)/gu,
      ),
    ].map((match) => match[1]);
    expect(connected).toEqual(["OpenRouter", "vLLM", "Custom"]);

    state.connections = [{ ...builtin, credential_state: "configured" }];
    const keyed = render(<ModelConnectionsSettings disabled={false} />);
    expect(selectedTab(keyed, "OpenAI")).toBe(true);
    expect(selectedTab(keyed, "Ollama")).toBe(true);
  });

  it("shows only that provider on each provider tab", () => {
    const html = render(<ModelConnectionsSettings disabled={false} />);
    const openai = panel(html, "openai");
    expectInOrder(openai, ["OpenAI", "Recommended", "Key missing"]);
    expect(openai).not.toContain("Router");
    const router = panel(html, "openrouter");
    expectInOrder(router, ["Router", "Key set", "qwen/qwen3-235b"]);
    expect(router).toContain('aria-label="Add model to Router"');
    expect(router).not.toContain("Base URL");
    // An unconnected provider shows its purpose and connect form inline.
    const deepseek = panel(html, "deepseek");
    expect(deepseek).toContain("DeepSeek API key");
    expect(deepseek).toContain("Base URL");
    expect(deepseek).toMatch(
      /<button[^>]*type="submit"[^>]*>Connect<\/button>/u,
    );
    expect(deepseek).not.toContain("Detect");
    // Custom offers another server; local connections stay off Cloud.
    const custom = panel(html, "custom-cloud");
    expect(custom).toContain("Add a custom server");
    expect(custom).not.toContain("Base URL");
    expect(panel(html, "cloud")).not.toContain("Workstation vLLM");
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
      "1M",
      "Built-in search",
      "Vision",
      "Tools",
      "128K",
      "App search",
    ]);
    expect(text(html)).not.toMatch(/\b(Responses|Completions)\b/u);
    // Only Anthropic's built-in search says who pays for each search.
    const billing = "Anthropic bills each search to your Anthropic account.";
    expect(text(panel(html, "anthropic"))).toContain(billing);
    expect(text(panel(html, "openai"))).not.toContain("bills");
    expect(text(panel(html, "openrouter"))).not.toContain("bills");
    // The hidden Chat Completions row waits behind a toggle.
    expect(html).not.toContain("gpt-6-luna-cc");
    expect(html).toContain("Show 1 hidden model");
  });

  it("lists local servers with their reachability, and connect forms with Detect", () => {
    const html = render(
      <ModelConnectionsSettings disabled={false} defaultTab="local" />,
    );
    expectInOrder(panel(html, "vllm"), [
      "Workstation vLLM",
      "Running at 127.0.0.1:8000",
    ]);
    expectInOrder(panel(html, "custom-local"), [
      "LAN box",
      "Not reachable",
      "Add a custom server",
    ]);
    const ollama = panel(html, "ollama");
    expect(ollama).toContain("Ollama on this computer");
    expect(ollama).toMatch(/>Detect<\/button>/u);
    // Card statuses are plain text, not one live region per card.
    expect(html).not.toContain('role="status"');
    expect(panel(html, "local")).not.toContain("Router");
  });

  it("checks local reachability only while Local is showing", () => {
    const html = render(<ModelConnectionsSettings disabled={false} />);
    expect(panel(html, "vllm")).toContain("Checking…");
  });

  it("puts each built-in connection's key field on its own card on desktop", () => {
    const html = render(<ModelConnectionsSettings disabled={false} />);
    const card = panel(html, "openai");
    expect(card).toMatch(/<label[^>]*>OpenAI<\/label>/u);
    expect(card).toContain('type="password"');
    expect(card).not.toMatch(/<label[^>]*>(Anthropic|ElevenLabs)<\/label>/u);
    const claude = panel(html, "anthropic");
    expect(claude).toMatch(/<label[^>]*>Anthropic<\/label>/u);
    expect(claude).toContain('type="password"');
    expect(claude).not.toMatch(/<label[^>]*>OpenAI<\/label>/u);
  });

  it("shows the built-in Anthropic connection with its logo, key state and Haiku 5.5", () => {
    const html = render(<ModelConnectionsSettings disabled={false} />);
    const claude = panel(html, "anthropic");
    expectInOrder(claude, ["Anthropic", "Key missing", "Claude Haiku 5.5"]);
    expect(claude).not.toContain("Recommended");
    expect(claude).toContain('aria-label="Add model to Anthropic"');
    // Built-in: neither editable nor removable.
    expect(claude).not.toContain('aria-label="Remove Anthropic"');
    expect(claude).not.toContain('aria-label="Edit Anthropic"');
    // The bundled models.dev mark, served with the app.
    expect(claude).toContain('src="/provider-logos/anthropic.svg"');

    state.connections = [{ ...anthropic, credential_state: "configured" }];
    const keyed = render(<ModelConnectionsSettings disabled={false} />);
    expect(selectedTab(keyed, "Anthropic")).toBe(true);
    expectInOrder(panel(keyed, "anthropic"), ["Anthropic", "Key set"]);
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
    expect(panel(html, "openai")).toContain("OPENAI_API_KEY");
    expect(panel(html, "anthropic")).toContain("ANTHROPIC_API_KEY");
    expect(panel(html, "anthropic")).not.toContain("OPENAI_API_KEY");
    expect(html).not.toContain('type="password"');
  });

  it("tells an unhidden same-name row apart without naming its API", () => {
    state.connections = [
      {
        ...builtin,
        models: [
          builtin.models![0],
          model("gpt-6-luna:cc", {
            model: "gpt-6-luna",
            model_label: "gpt-6-luna",
            source: "builtin",
          }),
        ],
      },
    ];
    const html = render(<ModelConnectionsSettings disabled={false} />);
    expect(html).toContain('aria-label="Details for gpt-6-luna"');
    expect(html).toContain('aria-label="Details for gpt-6-luna (alternate)"');
    expect(html.match(/\(alternate\)/gu)).toHaveLength(2);
    expect(text(html)).not.toMatch(/\b(Responses|Completions)\b/u);
  });

  it("renders nothing in the hosted composition", () => {
    state.capabilities = { model_configuration: false };
    expect(render(<ModelConnectionsSettings disabled={false} />)).toBe("");
    state.capabilities = undefined;
    expect(render(<ModelConnectionsSettings disabled={false} />)).toBe("");
  });
});
