import type { PyModelProviderCatalogItem } from "@animama/runtime-contracts/api-types";

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
export function modelOptionLabel(item: LabeledModel): string {
  const model = item.model_label?.trim() || item.model;
  const connection = modelConnectionLabel(item);
  return connection ? `${connection}: ${model}` : model;
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
