import type { PyModelProviderCatalogItem } from "@animama/runtime-contracts/api-types";
import { ANTHROPIC_MESSAGES_PROVIDER_TYPE } from "@animama/product-ui/chat";

/** Defined once in product-ui, whose web search rule also reads it. */
export { ANTHROPIC_MESSAGES_PROVIDER_TYPE };

type LabeledModel = Pick<
  PyModelProviderCatalogItem,
  "model" | "model_label" | "provider_label"
> &
  Partial<
    Pick<
      PyModelProviderCatalogItem,
      "connection_id" | "connection_name" | "model_provider"
    >
  >;

/** The connection a model runs on, so pickers group its models together. */
export function modelConnectionLabel(item: LabeledModel): string {
  return (
    item.connection_name?.trim() ||
    item.provider_label?.trim() ||
    item.model_provider ||
    ""
  );
}

/**
 * The line under a model's name in pickers: its connection. The app picks
 * the API, so pickers never name it; a model's Info panel in App Settings
 * does.
 */
export function modelOptionDetail(item: LabeledModel): string {
  return modelConnectionLabel(item);
}

/** "Connection: Model", falling back to the model id when labels are missing. */
export function modelOptionLabel(
  item: LabeledModel,
  alternate = false,
): string {
  const model = modelDisplayName(item, alternate);
  const connection = modelConnectionLabel(item);
  return connection ? `${connection}: ${model}` : model;
}

/** Neutral suffix telling apart two listed rows with one name. */
export const ALTERNATE_LABEL_SUFFIX = " (alternate)";

/** A model's shown name, with the alternate suffix when it needs one. */
export function modelDisplayName(
  item: Pick<LabeledModel, "model" | "model_label">,
  alternate = false,
): string {
  const name = item.model_label?.trim() || item.model;
  return alternate ? `${name}${ALTERNATE_LABEL_SUFFIX}` : name;
}

/**
 * API families a catalog row uses (`model_provider` on catalog items,
 * `provider_type` on configured models). The app picks the family: OpenAI
 * Responses on the built-in OpenAI connection, Anthropic Messages on the
 * built-in Anthropic connection and Chat Completions everywhere else.
 */
export const RESPONSES_PROVIDER_TYPE = "OpenAIResponsesHTTPAgent";
export const CHAT_COMPLETIONS_PROVIDER_TYPE = "OpenAIHTTPAgent";
export type ModelProviderType =
  | typeof RESPONSES_PROVIDER_TYPE
  | typeof CHAT_COMPLETIONS_PROVIDER_TYPE
  | typeof ANTHROPIC_MESSAGES_PROVIDER_TYPE;

/** A stored provider type as one of the known API families (Chat Completions otherwise). */
export function modelProviderType(
  value: string | null | undefined,
): ModelProviderType {
  return value === RESPONSES_PROVIDER_TYPE ||
    value === ANTHROPIC_MESSAGES_PROVIDER_TYPE
    ? value
    : CHAT_COMPLETIONS_PROVIDER_TYPE;
}

/** The built-in Anthropic connection's default model, Claude Haiku 5.5. */
export const ANTHROPIC_DEFAULT_MODEL_ID =
  "AnthropicMessagesHTTPAgent:claude-haiku-5-5";

/** Fields shared by catalog items and configured models that naming needs. */
type AlternateCandidate = {
  id: string;
  model: string;
  model_label?: string | null;
  connection_id?: string | null;
  model_kind?: string | null;
  /** Catalog items name the API here… */
  model_provider?: string | null;
  /** …and configured models here. */
  provider_type?: string | null;
};

/**
 * Ids of listed chat rows that need the alternate suffix: when rows on one
 * connection share a name (the built-in OpenAI connection can list a model
 * once per API), every row but the Responses one is marked. Without a
 * Responses row among them, rows after the first are marked. Pass only the
 * rows the list shows, so a hidden twin does not rename a visible row. No API
 * is named, because the app picks it.
 */
export function alternateModelIds(
  rows: readonly AlternateCandidate[],
): Set<string> {
  const groups = new Map<string, AlternateCandidate[]>();
  for (const row of rows) {
    if ((row.model_kind ?? "chat") !== "chat") continue;
    const key = `${row.connection_id ?? ""}\u0000${modelDisplayName(row)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const alternates = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const primary =
      group.find(
        (row) =>
          (row.model_provider ?? row.provider_type) === RESPONSES_PROVIDER_TYPE,
      ) ?? group[0];
    for (const row of group) if (row !== primary) alternates.add(row.id);
  }
  return alternates;
}

/** A row's reasoning efforts in the backend's display order. */
export function supportedReasoningEfforts(
  item: PyModelProviderCatalogItem | null | undefined,
): string[] {
  return Array.isArray(item?.supported_reasoning_efforts)
    ? item.supported_reasoning_efforts.filter(
        (effort) => typeof effort === "string",
      )
    : [];
}

/**
 * The effort a picker preselects for a row: the backend's reported default
 * (Anthropic rows report their chat default, `medium`) when the row offers
 * it, else the row's first supported effort. `null` for rows without efforts.
 */
export function defaultReasoningEffort(
  item: PyModelProviderCatalogItem | null | undefined,
): string | null {
  const efforts = supportedReasoningEfforts(item);
  const reported = item?.default_reasoning_effort;
  if (reported && efforts.includes(reported)) return reported;
  return efforts[0] ?? null;
}

/** Chat rows; rows from before model kinds existed count as chat. */
export function isChatModelRow(item: PyModelProviderCatalogItem): boolean {
  return (item.model_kind ?? "chat") === "chat";
}

/**
 * Chat models a picker may offer: never embedding models, and hidden models
 * only when one is the current choice (so the picker can still show it).
 */
export function selectableChatModels(
  items: readonly PyModelProviderCatalogItem[],
  currentId?: string | null,
): PyModelProviderCatalogItem[] {
  return items.filter(
    (item) => isChatModelRow(item) && (!item.hidden || item.id === currentId),
  );
}
