import type {
  PyConfiguredModel,
  PyEmbeddingRefreshStatus,
  PyModelConnection,
  PyModelConnectionDetection,
  PyModelProbeReport,
  PyModelProviderCatalogItem,
  PyModelUsage,
  PyOpenRouterModel,
  PyOwnerModelCapabilities,
  RuntimeCapabilities,
  WebSearchCapability,
} from "@animama/runtime-contracts/api-types";
import {
  modelRolePreferencePath,
  type ModelRole,
} from "@/lib/settings/preferences";
import { isChatModelRow } from "@/lib/chat/model-catalog";
import { chatModelSendGate } from "@/lib/chat/model-provider-compatibility";

/**
 * Models that can do a role, mirroring the server's rules: embeddings need an
 * embedding model, the Memory Manager needs tool calling, utility needs a
 * streaming chat model, and the Chat default also needs one direct chat can
 * send to. Owner models need a context window for streaming roles. Hidden
 * models are left out unless one is the current choice, which the server
 * still uses.
 */
export function roleCandidates(
  items: readonly PyModelProviderCatalogItem[],
  role: ModelRole,
  currentId?: string | null,
): PyModelProviderCatalogItem[] {
  return items.filter((item) => {
    if (item.hidden && item.id !== currentId) return false;
    if (role === "embeddings") return item.model_kind === "embedding";
    if (!isChatModelRow(item)) return false;
    if (role === "memory_manager") return Boolean(item.supports_tools);
    if (role === "chat" && !chatModelSendGate(null, item).ok) return false;
    return (
      Boolean(item.supports_streaming) &&
      (item.source !== "owner" || item.context_window_tokens != null)
    );
  });
}

/** Where a connection's models run: a cloud service or a server on this computer or network. */
export type ModelLocation = "cloud" | "local";

/** The two tabs of the Models section, in order. */
export const MODEL_LOCATION_TABS: ReadonlyArray<{
  id: ModelLocation;
  label: string;
}> = [
  { id: "cloud", label: "Cloud" },
  { id: "local", label: "Local" },
];

/**
 * A provider offered on a Models tab. `presetId` is the backend connection
 * preset; both Custom entries use the `custom` preset and differ only by
 * where their base URL points.
 */
export type ModelProviderEntry = {
  id: string;
  presetId: string;
  label: string;
  /** Shown with a Recommended tag (the built-in OpenAI connection). */
  recommended?: boolean;
};

/** Providers on each tab, in display order. */
export const MODEL_LOCATION_PROVIDERS: Record<
  ModelLocation,
  readonly ModelProviderEntry[]
> = {
  cloud: [
    { id: "openai", presetId: "openai", label: "OpenAI", recommended: true },
    { id: "deepseek", presetId: "deepseek", label: "DeepSeek" },
    { id: "huggingface", presetId: "huggingface", label: "Hugging Face" },
    { id: "openrouter", presetId: "openrouter", label: "OpenRouter" },
    { id: "custom-cloud", presetId: "custom", label: "Custom" },
  ],
  local: [
    { id: "ollama", presetId: "ollama", label: "Ollama" },
    { id: "lmstudio", presetId: "lmstudio", label: "LM Studio" },
    { id: "llamacpp", presetId: "llamacpp", label: "llama.cpp" },
    { id: "vllm", presetId: "vllm", label: "vLLM" },
    { id: "custom-local", presetId: "custom", label: "Custom" },
  ],
};

const LOCAL_PRESETS = new Set(["ollama", "lmstudio", "llamacpp", "vllm"]);

/** Parse an owner-typed base URL, accepting one without a scheme. */
function parseBaseUrl(baseUrl: string | null | undefined): URL | null {
  const value = (baseUrl ?? "").trim();
  if (!value) return null;
  try {
    return new URL(
      /^[a-z][a-z\d+.-]*:\/\//iu.test(value) ? value : `http://${value}`,
    );
  } catch {
    return null;
  }
}

/** Hostname without IPv6 brackets, lowercased. */
function bareHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
}

/** This computer: loopback names and addresses, and Docker's alias for the host. */
function isThisComputerHost(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "host.docker.internal" ||
    host === "::1" ||
    /^127\.\d+\.\d+\.\d+$/u.test(host)
  );
}

/**
 * This computer or a private network: loopback, `host.docker.internal`,
 * `.local` names, private and link-local IPv4 ranges, and IPv6 unique-local
 * and link-local addresses.
 */
export function isPrivateNetworkUrl(
  baseUrl: string | null | undefined,
): boolean {
  const url = parseBaseUrl(baseUrl);
  if (!url) return false;
  const host = bareHost(url);
  if (isThisComputerHost(host) || host === "0.0.0.0" || host.endsWith(".local"))
    return true;
  const ipv4 = /^(\d+)\.(\d+)\.\d+\.\d+$/u.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  return host.includes(":") && /^(f[cd]|fe[89ab])/u.test(host);
}

/**
 * The tab that lists a connection: the built-in connection and cloud presets
 * on Cloud, local server presets on Local, and a custom connection by where
 * its base URL points.
 */
export function connectionLocation(
  connection: Pick<PyModelConnection, "source" | "preset" | "base_url">,
): ModelLocation {
  if (connection.source === "builtin") return "cloud";
  if (LOCAL_PRESETS.has(connection.preset)) return "local";
  if (connection.preset === "custom")
    return isPrivateNetworkUrl(connection.base_url) ? "local" : "cloud";
  return "cloud";
}

/** The provider entry a connection belongs to; unknown presets count as Custom. */
export function connectionProviderEntry(
  connection: Pick<PyModelConnection, "source" | "preset" | "base_url">,
): ModelProviderEntry {
  const entries = MODEL_LOCATION_PROVIDERS[connectionLocation(connection)];
  const presetId =
    connection.source === "builtin" ? "openai" : connection.preset;
  return (
    entries.find(
      (entry) => entry.presetId === presetId && entry.presetId !== "custom",
    ) ?? entries[entries.length - 1]
  );
}

/** A provider on a tab with its connections; unconnected providers have none. */
export type ModelProviderGroup<C> = {
  entry: ModelProviderEntry;
  connections: C[];
};

/**
 * A tab's providers: connected ones first, then the rest, each part in the
 * tab's provider order.
 */
export function locationProviderGroups<
  C extends Pick<PyModelConnection, "source" | "preset" | "base_url">,
>(connections: readonly C[], location: ModelLocation): ModelProviderGroup<C>[] {
  const groups = MODEL_LOCATION_PROVIDERS[location].map((entry) => ({
    entry,
    connections: connections.filter(
      (connection) =>
        connectionLocation(connection) === location &&
        connectionProviderEntry(connection).id === entry.id,
    ),
  }));
  return [
    ...groups.filter((group) => group.connections.length > 0),
    ...groups.filter((group) => group.connections.length === 0),
  ];
}

/** `host:port` of a base URL, for "Running at …". */
export function baseUrlHost(baseUrl: string | null | undefined): string {
  return parseBaseUrl(baseUrl)?.host ?? (baseUrl ?? "").trim();
}

/** What listing a local connection's models found. */
export type ConnectionReachability =
  | { state: "checking" }
  | { state: "reachable" }
  | { state: "failed"; category: string | null };

const KEY_STATE_LABELS: Record<PyModelConnection["credential_state"], string> =
  {
    configured: "Key set",
    missing: "Key missing",
    not_required: "No key needed",
  };

const UNREACHABLE_CATEGORIES = new Set([
  "unreachable",
  "timeout",
  "invalid_base_url",
  "unexpected_response",
]);

/**
 * A connection card's status: the key state on Cloud; on Local, whether the
 * server answered a model listing ("Running at …" or "Not reachable").
 */
export function connectionStatusText(
  connection: Pick<
    PyModelConnection,
    "source" | "preset" | "base_url" | "credential_state"
  >,
  reachability?: ConnectionReachability,
): string {
  if (connectionLocation(connection) === "cloud")
    return KEY_STATE_LABELS[connection.credential_state];
  if (!reachability || reachability.state === "checking") return "Checking…";
  if (reachability.state === "reachable")
    return `Running at ${baseUrlHost(connection.base_url)}`;
  if (reachability.category === "credential_missing") return "Key missing";
  if (reachability.category === "credential_rejected") return "Key rejected";
  return UNREACHABLE_CATEGORIES.has(reachability.category ?? "unreachable")
    ? "Not reachable"
    : errorCategoryMessage(reachability.category);
}

/** The error code of a failed Models request, if it carries one. */
export function modelConfigurationErrorCode(error: unknown): string | null {
  const detail =
    error && typeof error === "object" && "detail" in error
      ? (error as { detail?: { code?: unknown } | null }).detail
      : undefined;
  return typeof detail?.code === "string" ? detail.code : null;
}

const RESPONSES_PROVIDER_TYPE = "OpenAIResponsesHTTPAgent";

/** The API a chat model uses; shown only in its Info panel. */
export function modelApiLabel(
  model: Pick<PyConfiguredModel, "provider_type">,
): "Responses" | "Chat Completions" {
  return model.provider_type === RESPONSES_PROVIDER_TYPE
    ? "Responses"
    : "Chat Completions";
}

/**
 * "128K" or "1M" for a context window. Round thousands use decimal units and
 * other multiples of 1024 binary ones, so 131072 also reads "128K".
 */
export function formatContextWindow(tokens: number): string {
  const base = tokens % 1000 !== 0 && tokens % 1024 === 0 ? 1024 : 1000;
  if (tokens >= base * base)
    return `${Math.round((tokens / (base * base)) * 10) / 10}M`;
  if (tokens >= base) return `${Math.round(tokens / base)}K`;
  return String(tokens);
}

/** One chip on a model row. */
export type ModelChip = {
  id: "embeddings" | "tools" | "context" | "web-search" | "vision";
  label: string;
  /** Longer wording for a tooltip and screen readers. */
  description: string;
};

/**
 * Capability chips for a model row, in order: Tools, Context, Web search and
 * Vision; an embedding model shows Embeddings only. Web search is "Built-in
 * search" when the model's own search can be requested (OpenAI Responses
 * models advertising it, mirroring the backend's requestable native tools),
 * "App search" when the model calls tools and the installation's search
 * service is ready, and absent otherwise.
 */
export function modelCapabilityChips(
  model: Pick<
    PyConfiguredModel,
    "model_kind" | "provider_type" | "capabilities" | "context_window_tokens"
  >,
  search: WebSearchCapability | null | undefined,
): ModelChip[] {
  if (model.model_kind === "embedding")
    return [
      {
        id: "embeddings",
        label: "Embeddings",
        description: "Embedding model for file and archive search",
      },
    ];
  const { capabilities } = model;
  const chips: ModelChip[] = [];
  if (capabilities.supports_tools)
    chips.push({ id: "tools", label: "Tools", description: "Calls tools" });
  if (model.context_window_tokens != null)
    chips.push({
      id: "context",
      label: formatContextWindow(model.context_window_tokens),
      description: `${model.context_window_tokens.toLocaleString("en-US")}-token context window`,
    });
  const builtInSearch =
    model.provider_type === RESPONSES_PROVIDER_TYPE &&
    (capabilities.native_tool_support ?? []).includes("web_search");
  if (builtInSearch)
    chips.push({
      id: "web-search",
      label: "Built-in search",
      description: "Searches the web with the provider's own search",
    });
  else if (
    capabilities.supports_tools &&
    search?.configured &&
    search.credential_state !== "missing"
  )
    chips.push({
      id: "web-search",
      label: "App search",
      description: "Searches the web with this app's search service",
    });
  if (capabilities.accepts.includes("image"))
    chips.push({
      id: "vision",
      label: "Vision",
      description: "Accepts images",
    });
  return chips;
}

/**
 * Which Models settings App Settings shows: only what the runtime lets the
 * owner configure (desktop and self-hosted web). The hosted composition
 * reports neither, so Models stays hidden there.
 */
export function modelSettingsAvailability(
  capabilities:
    | Pick<RuntimeCapabilities, "model_configuration" | "web_search">
    | null
    | undefined,
): { modelConfiguration: boolean; webSearchConfiguration: boolean } {
  return {
    modelConfiguration: capabilities?.model_configuration === true,
    webSearchConfiguration: capabilities?.web_search?.configuration === true,
  };
}

/**
 * Whether a key sent to this base URL would cross the network unencrypted:
 * plain `http` to a host other than this computer.
 */
export function keyWouldTravelInsecurely(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  return !isThisComputerHost(bareHost(url));
}

const CATEGORY_MESSAGES: Record<string, string> = {
  unreachable:
    "The server could not be reached. Check that it is running and that the base URL is correct.",
  credential_missing: "This connection needs a key before it can be used.",
  credential_rejected: "The server rejected the key.",
  model_not_found: "The server does not serve that model.",
  timeout: "The server did not answer in time.",
  rate_limited: "The server is limiting requests. Try again shortly.",
  quota_exceeded: "The account for this key has no remaining quota.",
  server_error: "The server reported an error. Try again shortly.",
  bad_request: "The server rejected the request.",
  context_exceeded: "The request was larger than the model's context window.",
  invalid_base_url: "The base URL is not valid.",
  unexpected_response:
    "The server's reply was not an OpenAI-compatible response. Check the base URL; it usually ends in /v1.",
  provider_error: "The server could not complete the request.",
};

/** Status line for a Detect result, naming the server type to start. */
export function detectionMessage(
  detection: PyModelConnectionDetection,
  serverName: string,
): string {
  const count = detection.models.length;
  return detection.reachable
    ? `Found ${count} ${count === 1 ? "model" : "models"} at ${detection.base_url}.`
    : `Nothing is running at ${detection.base_url}. Start ${serverName} and try again.`;
}

/** Plain-language text for an error category reported by the server. */
export function errorCategoryMessage(
  category: string | null | undefined,
): string {
  return (
    (category && CATEGORY_MESSAGES[category]) ??
    "The server could not complete the request."
  );
}

/**
 * Explain a failed Models request. Configuration errors carry the server's own
 * message; connection failures use category copy and never echo the model
 * server's response text.
 */
export function modelConfigurationErrorMessage(error: unknown): string {
  const detail =
    error && typeof error === "object" && "detail" in error
      ? (error as { detail?: unknown }).detail
      : undefined;
  if (!detail || typeof detail !== "object")
    return "The change could not be saved.";
  const { code, message } = detail as { code?: unknown; message?: unknown };
  if (typeof code === "string" && code in CATEGORY_MESSAGES)
    return CATEGORY_MESSAGES[code];
  return typeof message === "string" && message.trim()
    ? message
    : "The change could not be saved.";
}

/** Usage attached to a `model_in_use` refusal, if the error carries it. */
export function modelInUseUsage(error: unknown): PyModelUsage | null {
  const detail =
    error && typeof error === "object" && "detail" in error
      ? (error as { detail?: { code?: unknown; usage?: unknown } }).detail
      : undefined;
  return detail?.code === "model_in_use" && detail.usage
    ? (detail.usage as PyModelUsage)
    : null;
}

const ROLE_NAMES: Record<ModelRole, string> = {
  chat: "the Chat default",
  utility: "the Compaction model",
  memory_manager: "the Memory Manager model",
  embeddings: "the Embeddings model",
};

/** Role names keyed by the preference path the server reports in usage. */
const ROLE_PREFERENCE_LABELS = new Map(
  (Object.keys(ROLE_NAMES) as ModelRole[]).map((role) => [
    modelRolePreferencePath(role),
    ROLE_NAMES[role],
  ]),
);

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** "Used by Mira and Luna, and as the Compaction model." for a removal prompt. */
export function removalUsageSummary(usage: PyModelUsage): string {
  const animas = joinNames(
    (usage.animas ?? []).map((anima) => anima.display_name),
  );
  const roles = joinNames(
    (usage.roles ?? []).map((path) => ROLE_PREFERENCE_LABELS.get(path) ?? path),
  );
  if (animas && roles) return `Used by ${animas}, and as ${roles}.`;
  if (animas) return `Used by ${animas}.`;
  if (roles) return `Used as ${roles}.`;
  return "Not in use.";
}

/** What removing an in-use connection or model changes, for its confirmation. */
export function removalConsequences(usage: PyModelUsage): string {
  const consequences: string[] = [];
  if (usage.animas?.length)
    consequences.push(
      usage.animas.length === 1
        ? "That Anima shows its model as unavailable until you pick another."
        : "Those Animas show their model as unavailable until you pick another.",
    );
  if (usage.roles?.length)
    consequences.push(
      usage.roles.length === 1
        ? "That role goes back to its default."
        : "Those roles go back to their defaults.",
    );
  return consequences.join(" ");
}

/** Status line for the Embeddings role. */
export function embeddingsStatusText(
  refresh: PyEmbeddingRefreshStatus | null | undefined,
): string {
  switch (refresh?.state) {
    case "current":
      return "Stored files and archives are embedded with this model.";
    case "re_embedding":
      return `Re-embedding ${refresh.pending ?? 0} items; search uses keywords until it finishes.`;
    case "retrying":
      return `Re-embedding ${refresh.pending ?? 0} items is waiting to retry: ${errorCategoryMessage(
        refresh.error_category,
      )}`;
    default:
      return "Embeddings are off; file and archive search use keywords.";
  }
}

/** Capabilities the owner confirms when adding or editing a chat model. */
export type OwnerCapabilitiesDraft = Required<
  Pick<
    PyOwnerModelCapabilities,
    | "accepts_images"
    | "supports_streaming"
    | "supports_tools"
    | "tools_with_structured_output"
  >
> & {
  structured_output_transport: "json_schema" | "json_object" | null;
};

export const DEFAULT_CAPABILITIES_DRAFT: OwnerCapabilitiesDraft = {
  accepts_images: false,
  supports_streaming: true,
  supports_tools: false,
  tools_with_structured_output: true,
  structured_output_transport: "json_schema",
};

/** Prefill capabilities from a probe; values the probe could not determine are kept. */
export function capabilitiesFromProbe(
  report: PyModelProbeReport,
  current: OwnerCapabilitiesDraft,
): OwnerCapabilitiesDraft {
  const transport = report.structured_output_transport;
  return {
    ...current,
    supports_streaming: report.supports_streaming ?? current.supports_streaming,
    supports_tools: report.supports_tools ?? current.supports_tools,
    tools_with_structured_output:
      report.tools_with_structured_output ??
      current.tools_with_structured_output,
    structured_output_transport:
      transport === "json_schema" || transport === "json_object"
        ? transport
        : report.steps.some((step) => step.name === "structured_output")
          ? null
          : current.structured_output_transport,
  };
}

/**
 * OpenRouter models matching a search, optionally only those that call tools.
 * Every word must appear in the model's ID or name.
 */
export function filterOpenRouterModels(
  models: readonly PyOpenRouterModel[],
  { query, toolsOnly }: { query: string; toolsOnly: boolean },
): PyOpenRouterModel[] {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  return models.filter((model) => {
    if (toolsOnly && !model.supports_tools) return false;
    const text = `${model.id} ${model.name}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/**
 * Add-model fields prefilled from an OpenRouter model: its ID, name, context
 * window and the tool and structured-output support it advertises. Testing
 * the model can still confirm or override them.
 */
export function draftFromOpenRouterModel(
  model: PyOpenRouterModel,
  current: OwnerCapabilitiesDraft,
): {
  model: string;
  label: string;
  contextWindow: string;
  capabilities: OwnerCapabilitiesDraft;
} {
  return {
    model: model.id,
    label: model.name && model.name !== model.id ? model.name : "",
    contextWindow:
      model.context_length != null ? String(model.context_length) : "",
    capabilities: {
      ...current,
      supports_tools: model.supports_tools,
      structured_output_transport: model.supports_structured_outputs
        ? "json_schema"
        : null,
      tools_with_structured_output:
        model.supports_tools && model.supports_structured_outputs
          ? current.tools_with_structured_output
          : false,
    },
  };
}

/** Why the OpenRouter list is missing; the owner can still type a model ID. */
export function openRouterModelsErrorMessage(error: unknown): string {
  return modelConfigurationErrorCode(error) === "openrouter_models_unavailable"
    ? "OpenRouter's model list is unavailable right now. Type the model ID below instead."
    : "The OpenRouter model list could not be loaded. Type the model ID below instead.";
}
