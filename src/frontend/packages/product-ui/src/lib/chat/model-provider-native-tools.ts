import type {
  PyModelProviderCatalogItem,
  WebSearchCapability,
} from "@animama/runtime-contracts/api-types";

/** The request tool name for web search, hosted or application. */
export const WEB_SEARCH_TOOL = "web_search";

/**
 * The catalog `model_provider` of Anthropic Messages rows. Anthropic rows
 * search only with Anthropic's own server tool.
 */
export const ANTHROPIC_MESSAGES_PROVIDER_TYPE = "AnthropicMessagesHTTPAgent";

function normalizedTools(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

/** Returns native tools callers may explicitly select for a catalog row. */
export function requestableNativeTools(
  item: PyModelProviderCatalogItem | null | undefined,
): string[] {
  return normalizedTools(item?.requestable_native_tool_support);
}

/**
 * How a chat model row can search the web: the provider's hosted search, the
 * application `web_search` tool through the installation's configured
 * backend, or not at all with a reason for the owner. `null` means the row
 * has no hosted search and cannot use application search, so no control is
 * shown: this composition offers none, or the row is an Anthropic row, which
 * the backend never gives the application tool.
 */
export type WebSearchAvailability =
  | { state: "hosted" }
  | { state: "application" }
  | { state: "unavailable"; reason: string };

export function webSearchAvailability(
  item: PyModelProviderCatalogItem | null | undefined,
  search: WebSearchCapability | null | undefined,
): WebSearchAvailability | null {
  if (requestableNativeTools(item).includes(WEB_SEARCH_TOOL))
    return { state: "hosted" };
  if (
    !item ||
    item.model_provider === ANTHROPIC_MESSAGES_PROVIDER_TYPE ||
    !search?.configuration
  )
    return null;
  if (!item.supports_tools)
    return {
      state: "unavailable",
      reason: "This model can't call tools, so it can't search.",
    };
  if (!search.configured)
    return {
      state: "unavailable",
      reason: "Set up web search in App Settings.",
    };
  if (search.credential_state === "missing")
    return {
      state: "unavailable",
      reason:
        "The Brave Search key is not set. See Web search in App Settings.",
    };
  return { state: "application" };
}

/**
 * Native tools the owner may turn on for a row, including `web_search` served
 * by the application tool. The request field is the same either way; the
 * backend picks hosted or application search.
 */
export function selectableNativeTools(
  item: PyModelProviderCatalogItem | null | undefined,
  search: WebSearchCapability | null | undefined,
): string[] {
  const tools = requestableNativeTools(item);
  return webSearchAvailability(item, search)?.state === "application"
    ? [...tools, WEB_SEARCH_TOOL]
    : tools;
}

/**
 * A tool selection with web search turned on or off, other tools unchanged.
 * Used when search availability changes while the same model stays selected.
 */
export function withWebSearch(
  tools: readonly string[] | null | undefined,
  enabled: boolean,
): string[] {
  const others = (tools ?? []).filter((tool) => tool !== WEB_SEARCH_TOOL);
  return enabled ? [...others, WEB_SEARCH_TOOL] : others;
}

/** Drops stale or internal tool names before they enter a chat request. */
export function filterRequestableNativeTools(
  requestedTools: unknown,
  supportedTools: unknown,
): string[] {
  const supported = new Set(normalizedTools(supportedTools));
  return normalizedTools(requestedTools).filter((tool) => supported.has(tool));
}
