import type {
  PyAnimaChatRequest,
  PyAnimaDispatchOptions,
} from "@animama/runtime-contracts/api-types";
import { filterRequestableNativeTools } from "./model-provider-native-tools";

type BuildChatSseRequestBodyArgs = {
  message: string;
  runId: string;
  chatId: string;
  modelProviderId: string | null | undefined;
  runtimeRevision: string;
  attachedFileIds?: string[] | null;
  dispatchOptions?: PyAnimaDispatchOptions | null;
  requestableNativeTools?: string[] | null;
};

function hasDispatchOptions(
  dispatchOptions: PyAnimaDispatchOptions | null | undefined,
): dispatchOptions is PyAnimaDispatchOptions {
  return Boolean(dispatchOptions && Object.keys(dispatchOptions).length > 0);
}

/**
 * Builds the direct `chat:sse` request body from the currently selected model row.
 */
export function buildChatSseRequestBody({
  message,
  runId,
  chatId,
  modelProviderId,
  runtimeRevision,
  attachedFileIds,
  dispatchOptions,
  requestableNativeTools,
}: BuildChatSseRequestBodyArgs): PyAnimaChatRequest {
  const trimmedModelProviderId =
    typeof modelProviderId === "string" ? modelProviderId.trim() : "";
  const normalizedAttachedFileIds = Array.from(
    new Set(
      (attachedFileIds ?? [])
        .map((fileId) => fileId.trim())
        .filter((fileId) => fileId.length > 0),
    ),
  );
  const sanitizedDispatchOptions =
    dispatchOptions &&
    Array.isArray(dispatchOptions.native_tools) &&
    Array.isArray(requestableNativeTools)
      ? {
          ...dispatchOptions,
          native_tools: filterRequestableNativeTools(
            dispatchOptions.native_tools,
            requestableNativeTools,
          ),
        }
      : dispatchOptions;

  return {
    message,
    run_id: runId,
    chat_id: chatId,
    runtime_revision: runtimeRevision,
    ...(normalizedAttachedFileIds.length > 0
      ? { attached_file_ids: normalizedAttachedFileIds }
      : {}),
    ...(trimmedModelProviderId
      ? { model_provider_id: trimmedModelProviderId }
      : {}),
    ...(hasDispatchOptions(sanitizedDispatchOptions)
      ? { dispatch_options: sanitizedDispatchOptions }
      : {}),
  };
}
