import type {
  PyChatResponse,
  PyModelProviderCatalogItem,
} from "@animama/runtime-contracts/api-types";

export type ChatModelSendGate =
  | { ok: true; reason: "compatible" | "uninitialized_chat" | "new_chat" }
  | { ok: false; reason: "missing_model" }
  | { ok: false; reason: "unsupported_model" }
  | {
      ok: false;
      reason: "api_standard_mismatch";
      chatApiStandard: string;
      selectedApiStandard: string;
    };

/**
 * The catalog row a chat last used. Chats that recorded a row id restore only
 * that row, since several connections can serve the same model name; a removed
 * row restores nothing, leaving the Anima's model unavailable until the owner
 * picks another. Chats recorded before row ids match the client, model name
 * and API standard.
 */
export function findRestorableChatModel(
  chat: PyChatResponse | null | undefined,
  models: PyModelProviderCatalogItem[],
): PyModelProviderCatalogItem | null {
  const chatModels = models.filter(
    (model) => (model.model_kind ?? "chat") === "chat",
  );
  if (chat?.last_model_provider_id) {
    return (
      chatModels.find((model) => model.id === chat.last_model_provider_id) ??
      null
    );
  }
  if (!chat?.last_model_client || !chat.last_model_id || !chat.api_standard) {
    return null;
  }

  return (
    chatModels.find(
      (model) =>
        model.model_client === chat.last_model_client &&
        model.model === chat.last_model_id &&
        model.api_standard === chat.api_standard,
    ) ?? null
  );
}

export function chatModelSendGate(
  chat: PyChatResponse | null | undefined,
  selectedModel: PyModelProviderCatalogItem | null | undefined,
): ChatModelSendGate {
  if (!selectedModel) {
    return { ok: false, reason: "missing_model" };
  }
  if (!selectedModel.api_standard) {
    return { ok: false, reason: "unsupported_model" };
  }
  if (!chat) {
    return { ok: true, reason: "new_chat" };
  }
  if (!chat.api_standard) {
    return { ok: true, reason: "uninitialized_chat" };
  }
  if (chat.api_standard !== selectedModel.api_standard) {
    return {
      ok: false,
      reason: "api_standard_mismatch",
      chatApiStandard: chat.api_standard,
      selectedApiStandard: selectedModel.api_standard,
    };
  }
  return { ok: true, reason: "compatible" };
}
