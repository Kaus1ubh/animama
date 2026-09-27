import type { PyModelProviderCatalogItem } from "@animama/runtime-contracts/api-types";

type LabeledModel = Pick<
  PyModelProviderCatalogItem,
  "model" | "model_label" | "provider_label"
>;

/** "Provider: Model", falling back to the model id when labels are missing. */
export function modelOptionLabel(item: LabeledModel): string {
  const model = item.model_label?.trim() || item.model;
  const provider = item.provider_label?.trim();
  return provider ? `${provider}: ${model}` : model;
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
