import type {
  PyConfiguredModel,
  PyEmbeddingRefreshStatus,
  PyModelConnection,
  PyModelConnectionDetection,
  PyModelProbeReport,
  PyModelProviderCatalogItem,
  PyModelUsage,
  PyOwnerModelCapabilities,
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

/**
 * The fixed tabs of the Models section, in order. OpenAI holds the built-in
 * connection; each local server tab holds connections of its preset; Custom
 * holds every other owner connection (DeepSeek, Hugging Face and custom URLs).
 */
export const MODEL_SERVER_TABS = [
  { id: "openai", label: "OpenAI" },
  { id: "ollama", label: "Ollama" },
  { id: "lmstudio", label: "LM Studio" },
  { id: "llamacpp", label: "llama.cpp" },
  { id: "vllm", label: "vLLM" },
  { id: "custom", label: "Custom" },
] as const;

export type ModelServerTab = (typeof MODEL_SERVER_TABS)[number]["id"];

/** Presets offered by the Custom tab's Add connection form, in order. */
export const CUSTOM_TAB_PRESET_IDS = ["deepseek", "huggingface", "custom"];

const LOCAL_SERVER_TABS = new Set<string>([
  "ollama",
  "lmstudio",
  "llamacpp",
  "vllm",
]);

/** The Models tab that lists a connection. */
export function connectionServerTab(
  connection: Pick<PyModelConnection, "source" | "preset">,
): ModelServerTab {
  if (connection.source === "builtin") return "openai";
  return LOCAL_SERVER_TABS.has(connection.preset)
    ? (connection.preset as ModelServerTab)
    : "custom";
}

/** The tag on a model's row: its API, or Embeddings for an embedding model. */
export type ModelApiTag = "Responses" | "Completions" | "Embeddings";

export function modelApiTag(
  model: Pick<PyConfiguredModel, "model_kind" | "provider_type">,
): ModelApiTag {
  if (model.model_kind === "embedding") return "Embeddings";
  return model.provider_type === "OpenAIResponsesHTTPAgent"
    ? "Responses"
    : "Completions";
}

const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "host.docker.internal",
  "[::1]",
  "::1",
]);

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
  const host = url.hostname.toLowerCase();
  return !(
    LOCAL_HOSTNAMES.has(host) ||
    host.endsWith(".localhost") ||
    /^127\.\d+\.\d+\.\d+$/u.test(host)
  );
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
