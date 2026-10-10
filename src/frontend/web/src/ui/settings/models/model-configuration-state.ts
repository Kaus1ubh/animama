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
import type { TFunction } from "i18next";
import { getI18n } from "react-i18next";
import {
  apiErrorLine,
  apiErrorText,
  errorWording,
  readApiError,
  type ApiErrorText,
} from "@/lib/errors/apiError";
import {
  modelRolePreferencePath,
  type ModelRole,
} from "@/lib/settings/preferences";
import { isChatModelRow } from "@/lib/chat/model-catalog";
import {
  WEB_SEARCH_TOOL,
  webSearchAvailability,
} from "@/lib/chat/model-provider-native-tools";
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
export const MODEL_LOCATION_TABS: readonly ModelLocation[] = ["cloud", "local"];

/** A location tab's name in the active UI Locale. */
export function modelLocationLabel(location: ModelLocation): string {
  const t = getI18n().getFixedT(null, "models");
  return location === "cloud" ? t("locations.cloud") : t("locations.local");
}

/** Provider entry ids; both Custom entries use the `custom` preset. */
export type ModelProviderId =
  | "openai"
  | "deepseek"
  | "huggingface"
  | "openrouter"
  | "custom-cloud"
  | "ollama"
  | "lmstudio"
  | "llamacpp"
  | "vllm"
  | "custom-local";

/**
 * A provider offered on a Models tab. `presetId` is the backend connection
 * preset; both Custom entries use the `custom` preset and differ only by
 * where their base URL points. Display text comes from `modelProviderLabel`
 * and `modelProviderPurpose`.
 */
export type ModelProviderEntry = {
  id: ModelProviderId;
  presetId: string;
  /** The provider's product name; `null` for the translated "Custom". */
  name: string | null;
  /** Shown with a Recommended tag (the built-in OpenAI connection). */
  recommended?: boolean;
};

/** Providers on each tab, in display order. */
export const MODEL_LOCATION_PROVIDERS: Record<
  ModelLocation,
  readonly ModelProviderEntry[]
> = {
  cloud: [
    { id: "openai", presetId: "openai", name: "OpenAI", recommended: true },
    { id: "deepseek", presetId: "deepseek", name: "DeepSeek" },
    { id: "huggingface", presetId: "huggingface", name: "Hugging Face" },
    { id: "openrouter", presetId: "openrouter", name: "OpenRouter" },
    { id: "custom-cloud", presetId: "custom", name: null },
  ],
  local: [
    { id: "ollama", presetId: "ollama", name: "Ollama" },
    { id: "lmstudio", presetId: "lmstudio", name: "LM Studio" },
    { id: "llamacpp", presetId: "llamacpp", name: "llama.cpp" },
    { id: "vllm", presetId: "vllm", name: "vLLM" },
    { id: "custom-local", presetId: "custom", name: null },
  ],
};

/** A provider tab's name: the product name, or "Custom" in the active UI Locale. */
export function modelProviderLabel(entry: ModelProviderEntry): string {
  const t = getI18n().getFixedT(null, "models");
  return entry.name ?? t("providers.custom");
}

/** One line of purpose shown on a provider's tab, in the active UI Locale. */
export function modelProviderPurpose(entry: ModelProviderEntry): string {
  const t = getI18n().getFixedT(null, "models");
  switch (entry.id) {
    case "openai":
      return t("providers.purpose.openai");
    case "deepseek":
      return t("providers.purpose.deepseek");
    case "huggingface":
      return t("providers.purpose.huggingface");
    case "openrouter":
      return t("providers.purpose.openrouter");
    case "custom-cloud":
      return t("providers.purpose.customCloud");
    case "ollama":
      return t("providers.purpose.ollama");
    case "lmstudio":
      return t("providers.purpose.lmstudio");
    case "llamacpp":
      return t("providers.purpose.llamacpp");
    case "vllm":
      return t("providers.purpose.vllm");
    case "custom-local":
      return t("providers.purpose.customLocal");
    default: {
      // Every provider entry needs its own purpose.
      const unworded: never = entry.id;
      return unworded;
    }
  }
}

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

/** Name suffixes used only inside home, office and tailnet networks. */
const PRIVATE_NAME_SUFFIXES = [
  ".local",
  ".lan",
  ".home.arpa",
  ".internal",
  ".ts.net",
];

/**
 * This computer or a private network: loopback, single-label names (such as
 * `gpu-box`), private-use name suffixes (`.local`, `.lan`, `.home.arpa`,
 * `.internal`, Tailscale's `.ts.net`), private, link-local and Tailscale
 * (100.64.0.0/10) IPv4 ranges, and IPv6 unique-local and link-local addresses.
 */
export function isPrivateNetworkUrl(
  baseUrl: string | null | undefined,
): boolean {
  const url = parseBaseUrl(baseUrl);
  if (!url) return false;
  const host = bareHost(url);
  if (host.includes(":"))
    return host === "::1" || /^(f[cd]|fe[89ab])/u.test(host);
  if (
    isThisComputerHost(host) ||
    host === "0.0.0.0" ||
    !host.includes(".") ||
    PRIVATE_NAME_SUFFIXES.some((suffix) => host.endsWith(suffix))
  )
    return true;
  const ipv4 = /^(\d+)\.(\d+)\.\d+\.\d+$/u.exec(host);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
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
 * A tab's providers in tab order, each with its connections in that
 * location. Custom collects every custom connection whose address points
 * there, and unknown presets count as Custom.
 */
export function locationProviderGroups<
  C extends Pick<PyModelConnection, "source" | "preset" | "base_url">,
>(connections: readonly C[], location: ModelLocation): ModelProviderGroup<C>[] {
  return MODEL_LOCATION_PROVIDERS[location].map((entry) => ({
    entry,
    connections: connections.filter(
      (connection) =>
        connectionLocation(connection) === location &&
        connectionProviderEntry(connection).id === entry.id,
    ),
  }));
}

/** What `providerConnected` reads from a connection. */
export type ProviderConnectionState = Pick<PyModelConnection, "source"> & {
  credential_state?: PyModelConnection["credential_state"];
};

/**
 * Whether a provider tab is marked connected: it has a connection, except
 * the built-in OpenAI connection, which always exists and counts only once
 * its key is set.
 */
export function providerConnected(
  group: ModelProviderGroup<ProviderConnectionState>,
): boolean {
  return group.connections.some(
    (connection) =>
      connection.source !== "builtin" ||
      connection.credential_state === "configured",
  );
}

/**
 * The provider tab a location opens on: the first connected provider in
 * tab order, else the first provider (OpenAI or Ollama).
 */
export function defaultLocationProvider(
  groups: readonly ModelProviderGroup<ProviderConnectionState>[],
): string {
  return (groups.find(providerConnected) ?? groups[0]).entry.id;
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
  const t = getI18n().getFixedT(null, "models");
  if (connectionLocation(connection) === "cloud") {
    switch (connection.credential_state) {
      case "configured":
        return t("connections.status.keySet");
      case "missing":
        return t("connections.status.keyMissing");
      case "not_required":
        return t("connections.status.noKeyNeeded");
    }
  }
  if (!reachability || reachability.state === "checking")
    return t("connections.status.checking");
  if (reachability.state === "reachable")
    return t("connections.status.runningAt", {
      host: baseUrlHost(connection.base_url),
    });
  if (reachability.category === "credential_missing")
    return t("connections.status.keyMissing");
  if (reachability.category === "credential_rejected")
    return t("connections.status.keyRejected");
  return UNREACHABLE_CATEGORIES.has(reachability.category ?? "unreachable")
    ? t("connections.status.notReachable")
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
  const t = getI18n().getFixedT(null, "models");
  if (model.model_kind === "embedding")
    return [
      {
        id: "embeddings",
        label: t("chips.embeddings.label"),
        description: t("chips.embeddings.description"),
      },
    ];
  const { capabilities } = model;
  const chips: ModelChip[] = [];
  if (capabilities.supports_tools)
    chips.push({
      id: "tools",
      label: t("chips.tools.label"),
      description: t("chips.tools.description"),
    });
  if (model.context_window_tokens != null)
    chips.push({
      id: "context",
      label: formatContextWindow(model.context_window_tokens),
      description: t("chips.context.description", {
        tokens: model.context_window_tokens,
      }),
    });
  // PyConfiguredModel lacks requestable_native_tool_support, so mirror the
  // backend's rule (only Responses models may request native web search),
  // then let the chat picker's webSearchAvailability decide, which reads only
  // these two fields.
  const requestable =
    model.provider_type === RESPONSES_PROVIDER_TYPE &&
    (capabilities.native_tool_support ?? []).includes(WEB_SEARCH_TOOL)
      ? [WEB_SEARCH_TOOL]
      : [];
  const searchState = webSearchAvailability(
    {
      requestable_native_tool_support: requestable,
      supports_tools: capabilities.supports_tools,
    } as PyModelProviderCatalogItem,
    search,
  )?.state;
  if (searchState === "hosted")
    chips.push({
      id: "web-search",
      label: t("chips.builtInSearch.label"),
      description: t("chips.builtInSearch.description"),
    });
  else if (searchState === "application")
    chips.push({
      id: "web-search",
      label: t("chips.appSearch.label"),
      description: t("chips.appSearch.description"),
    });
  if (capabilities.accepts.includes("image"))
    chips.push({
      id: "vision",
      label: t("chips.vision.label"),
      description: t("chips.vision.description"),
    });
  return chips;
}

/**
 * Model choices and provider administration are independent permissions.
 * Hosted owners can select admitted role models without configuring providers.
 */
export function modelSettingsAvailability(
  capabilities:
    | Partial<
        Pick<
          RuntimeCapabilities,
          "model_configuration" | "model_role_selection" | "web_search"
        >
      >
    | null
    | undefined,
): {
  modelConfiguration: boolean;
  modelRoleSelection: boolean;
  webSearchConfiguration: boolean;
} {
  return {
    modelConfiguration: capabilities?.model_configuration === true,
    modelRoleSelection: capabilities?.model_role_selection === true,
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

/** Status line for a Detect result, naming the server type to start. */
export function detectionMessage(
  detection: PyModelConnectionDetection,
  serverName: string,
): string {
  const t = getI18n().getFixedT(null, "models");
  return detection.reachable
    ? t("connectionForm.detected", {
        count: detection.models.length,
        baseUrl: detection.base_url,
      })
    : getI18n().t("errors:modelConfiguration.detectionNotRunning", {
        baseUrl: detection.base_url,
        server: serverName,
      });
}

/** Plain-language text for an error category reported by the server. */
export function errorCategoryMessage(
  category: string | null | undefined,
): string {
  return (
    (category && errorWording("modelConfiguration", category)) ||
    getI18n().t("errors:modelConfiguration.provider_error")
  );
}

/**
 * Explain a failed Models request. Connection failures use category wording
 * and never echo the model server's response text; other configuration errors
 * carry the server's message (English, so secondary outside English).
 */
export function modelConfigurationErrorText(error: unknown): ApiErrorText {
  const saveFailed = getI18n().t("errors:modelConfiguration.saveFailed");
  const detail =
    error && typeof error === "object" && "detail" in error
      ? (error as { detail?: unknown }).detail
      : undefined;
  if (!detail || typeof detail !== "object")
    return { message: saveFailed, detail: null };
  return apiErrorText(readApiError(error), "modelConfiguration", saveFailed);
}

/** `modelConfigurationErrorText` as one line, for toasts. */
export function modelConfigurationErrorMessage(error: unknown): string {
  return apiErrorLine(modelConfigurationErrorText(error));
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

/** A role's name inside a removal summary ("the Compaction model"). */
function removalRoleName(t: TFunction<"models">, role: ModelRole): string {
  switch (role) {
    case "chat":
      return t("removal.roles.chat");
    case "utility":
      return t("removal.roles.utility");
    case "memory_manager":
      return t("removal.roles.memoryManager");
    case "embeddings":
      return t("removal.roles.embeddings");
    default: {
      // Every role needs its own name.
      const unnamed: never = role;
      return unnamed;
    }
  }
}

const MODEL_ROLES: readonly ModelRole[] = [
  "chat",
  "utility",
  "memory_manager",
  "embeddings",
];

/** "Used by Mira and Luna, and as the Compaction model." for a removal prompt. */
export function removalUsageSummary(usage: PyModelUsage): string {
  const t = getI18n().getFixedT(null, "models");
  // Usage names roles by the preference path the server stores them under.
  const roleNames = new Map(
    MODEL_ROLES.map((role) => [
      modelRolePreferencePath(role),
      removalRoleName(t, role),
    ]),
  );
  const animas = (usage.animas ?? []).map((anima) => anima.display_name);
  const roles = (usage.roles ?? []).map((path) => roleNames.get(path) ?? path);
  if (animas.length && roles.length)
    return t("removal.usage.animasAndRoles", { animas, roles });
  if (animas.length) return t("removal.usage.animas", { animas });
  if (roles.length) return t("removal.usage.roles", { roles });
  return t("removal.usage.none");
}

/** What removing an in-use connection or model changes, for its confirmation. */
export function removalConsequences(usage: PyModelUsage): string {
  const t = getI18n().getFixedT(null, "models");
  const consequences: string[] = [];
  if (usage.animas?.length)
    consequences.push(
      t("removal.consequences.animas", { count: usage.animas.length }),
    );
  if (usage.roles?.length)
    consequences.push(
      t("removal.consequences.roles", { count: usage.roles.length }),
    );
  return consequences.join(" ");
}

/** Status line for the Embeddings role. */
export function embeddingsStatusText(
  refresh: PyEmbeddingRefreshStatus | null | undefined,
): string {
  const t = getI18n().getFixedT(null, "models");
  switch (refresh?.state) {
    case "current":
      return t("embeddings.current");
    case "re_embedding":
      return t("embeddings.reEmbedding", { count: refresh.pending ?? 0 });
    case "retrying":
      return t("embeddings.retrying", {
        count: refresh.pending ?? 0,
        reason: errorCategoryMessage(refresh.error_category),
      });
    default:
      return t("embeddings.off");
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
    ? getI18n().t("errors:modelConfiguration.openrouter_models_unavailable")
    : getI18n().t("errors:modelConfiguration.openRouterModelsLoadFailed");
}
