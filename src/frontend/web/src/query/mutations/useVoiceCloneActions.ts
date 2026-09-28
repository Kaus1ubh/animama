import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PyVoiceContent } from "@animama/runtime-contracts/api-types";
import {
  deleteContentItemV1ContentItemsItemIdDelete,
  getContentItemV1ContentItemsItemIdGet,
  saveVoiceContent,
} from "@animama/runtime-contracts/sdk";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { ContentSaveApiError } from "@/lib/content/contentSaveErrors";
import {
  loadVoiceCloneFile,
  POCKET_VOICE_CLONE_CODEC,
  toVoiceCloneError,
  voiceCloneName,
  type PreparedVoiceClone,
} from "@/lib/speech/pocket/voice-clones";
import { queryKeys } from "@/query/keys";
import { invalidateVoiceCloneConsumers } from "@/query/animaLoadoutInvalidation";

/** Save captured bytes and identity unchanged; callers retain the prepared value for retries. */
export async function savePreparedVoiceClone(
  input: PreparedVoiceClone,
): Promise<PyVoiceContent> {
  try {
    const result = await saveVoiceContent({
      path: { entry_name: input.entryName },
      body: {
        operation_id: input.operationId,
        catalog_item_id: input.catalogItemId,
        expected_revision: input.expectedRevision,
        descriptor_json: JSON.stringify(input.descriptor),
        companion_paths_json: JSON.stringify(
          input.descriptor.files.map((file) => file.path),
        ),
        files: input.files,
      },
      requestValidator: undefined,
      responseValidator: undefined,
      throwOnError: false,
    });
    if (result.error !== undefined || !result.data) {
      throw toVoiceCloneError(result.error, result.response.status);
    }
    return result.data;
  } catch (error) {
    throw toVoiceCloneError(error);
  }
}

function requireEditableClone(clone: PyVoiceContent) {
  if (
    !clone.editable ||
    clone.source !== "local" ||
    clone.codec !== POCKET_VOICE_CLONE_CODEC
  ) {
    throw new Error("Only saved Local voice clones can be changed.");
  }
}

/** Rename through the atomic typed Save path, retaining both registered files and provenance. */
export async function renameSavedVoiceClone({
  clone,
  name,
  operationId = crypto.randomUUID(),
}: {
  clone: PyVoiceContent;
  name: string;
  operationId?: string;
}): Promise<PyVoiceContent> {
  requireEditableClone(clone);
  const displayName = voiceCloneName(name);
  try {
    const { data: current } = await getContentItemV1ContentItemsItemIdGet({
      path: { item_id: clone.item_id },
      responseValidator: undefined,
      throwOnError: true,
    });
    if (current.revision_sha256 !== clone.revision_sha256) {
      throw new ContentSaveApiError(
        409,
        "catalog_revision_conflict",
        "This voice changed. Reload the voice library before renaming it.",
      );
    }
    // The typed inventory also contains the descriptor; Save generates that file.
    const files = (clone.files ?? []).filter(
      (file) =>
        file.role === "source_sample" || file.role === "pocket_voice_catalog",
    );
    if (
      files.length !== 2 ||
      !files.some((file) => file.role === "source_sample") ||
      !files.some((file) => file.role === "pocket_voice_catalog")
    ) {
      throw new Error(
        "This voice is missing its original recording or encoded catalog.",
      );
    }
    const retainedFiles = await Promise.all(
      files.map(
        async (file) =>
          new File([await loadVoiceCloneFile(file)], file.filename, {
            type: file.media_type,
          }),
      ),
    );
    return await savePreparedVoiceClone({
      entryName: current.relative_locator.split("/").at(-1) || clone.item_id,
      operationId,
      catalogItemId: clone.item_id,
      expectedRevision: clone.revision_sha256,
      descriptor: {
        ...current.metadata,
        name: displayName,
        files: files.map((file) => ({
          path: file.logical_path,
          role: file.role,
        })),
      },
      files: retainedFiles,
    });
  } catch (error) {
    throw toVoiceCloneError(error);
  }
}

/** The server guards both stale revisions and references from any Anima. */
export async function deleteSavedVoiceClone(
  clone: PyVoiceContent,
): Promise<void> {
  requireEditableClone(clone);
  try {
    const result = await deleteContentItemV1ContentItemsItemIdDelete({
      path: { item_id: clone.item_id },
      query: { expected_revision: clone.revision_sha256 },
      responseValidator: undefined,
      throwOnError: false,
    });
    if (result.error !== undefined) {
      throw toVoiceCloneError(result.error, result.response.status);
    }
  } catch (error) {
    throw toVoiceCloneError(error);
  }
}

/** Shared library mutations never equip a clone or change provider preferences. */
export function useVoiceCloneActions() {
  const owner = useRuntimeOwnerId();
  const client = useQueryClient();
  const refresh = async () => {
    if (!owner) return;
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.voiceContent.all(owner) }),
      client.invalidateQueries({ queryKey: queryKeys.content.catalog(owner) }),
    ]);
  };
  return {
    saveVoiceClone: useMutation({
      mutationFn: savePreparedVoiceClone,
      onSuccess: refresh,
    }),
    renameVoiceClone: useMutation({
      mutationFn: renameSavedVoiceClone,
      onSuccess: async (clone) => {
        await Promise.all([
          refresh(),
          owner
            ? invalidateVoiceCloneConsumers(client, owner, clone.item_id)
            : Promise.resolve(),
        ]);
      },
    }),
    deleteVoiceClone: useMutation({
      mutationFn: deleteSavedVoiceClone,
      onSuccess: refresh,
    }),
  };
}
