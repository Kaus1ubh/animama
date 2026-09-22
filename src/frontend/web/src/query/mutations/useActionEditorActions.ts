"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  previewGesture,
  previewReaction,
} from "@animama/runtime-contracts/sdk";
import type {
  PyActionPreview,
  PyContentFile,
  PyExactContentSource,
  PyGesture,
  PyReaction,
} from "@/lib/content/catalogTypes";
import { catalogViewItem } from "@/lib/content/catalogTypes";
import { typedActionPreview } from "@/lib/content/typedPreviewAdapters";
import {
  getTypedActionCatalogItem,
  listCatalogItems,
  saveCatalogItem,
} from "@/lib/content/catalogApi";
import { contentSaveFieldError } from "@/lib/content/contentSaveErrors";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import type {
  ActionDocument,
  ActionIntent,
} from "@/ui/action-editor/actionDocument";

type EditSessionIdentity = {
  itemId: string;
  itemRevision: string | null;
  sessionId: string;
  sessionRevision: number;
};

type PendingAction = {
  document: ActionDocument;
  file?: File;
  itemId?: string;
  expectedRevision?: string | null;
  savedItemId?: string;
  savedRevision?: string | null;
};

const pendingActions = new Map<string, PendingAction>();

function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "untitled"
  );
}

function dependencyReference(source: PyExactContentSource): string {
  if (source.type === "builtin") return source.content_id;
  return source.logical_key || source.catalog_item_id;
}

/** Build the readable sidecar, omitting optional placement until chosen. */
export function actionDescriptorFor(
  document: ActionDocument,
  logicalKey: string,
) {
  const companionName =
    document.implementation === "vrma"
      ? `${slug(document.name)}.vrma`
      : `${slug(document.name)}.json`;
  return {
    companionName,
    descriptor: {
      schema_version: 1,
      content_type: document.intent,
      id: logicalKey,
      name: document.name.trim(),
      description: document.description.trim() || undefined,
      ai_description: document.aiDescription.trim() || undefined,
      notes: document.notes.trim() || undefined,
      ...(document.intent === "gesture"
        ? { semantic_key: document.semanticKey.trim() }
        : document.suggestedEmotion.trim()
          ? {
              placement_hint: {
                emotion: document.suggestedEmotion.trim(),
                intensity: document.suggestedIntensity,
              },
            }
          : {}),
      implementation: {
        kind: document.implementation,
        file_role:
          document.implementation === "vrma" ? "animation" : "sequence",
      },
      files: [
        {
          path: companionName,
          role: document.implementation === "vrma" ? "animation" : "sequence",
        },
      ],
      dependencies: document.dependencies.map((dependency) => ({
        ref: dependencyReference(dependency.source),
        alias: dependency.alias,
        content_type: dependency.content_type,
        source: dependency.source,
        config: dependency.config ?? {},
      })),
    },
  };
}

/** Direct editable-catalog operations used by the Gesture and Reaction studio. */
export function useActionEditorActions(intent: ActionIntent) {
  const queryClient = useQueryClient();
  const userId = useRuntimeOwnerId() ?? "__anon__";
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey:
          intent === "gesture"
            ? queryKeys.gestures.all(userId)
            : queryKeys.reactions.all(userId),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.content.catalog(userId),
      }),
    ]);
  };

  const previewSavedAction = async (
    itemId: string,
  ): Promise<PyActionPreview> => {
    const options = {
      path: { item_id: itemId },
      responseValidator: undefined,
      throwOnError: true as const,
    };
    return typedActionPreview(
      intent === "gesture"
        ? (await previewGesture(options)).data
        : (await previewReaction(options)).data,
    );
  };

  async function persist(
    identity: EditSessionIdentity,
    document: ActionDocument,
  ) {
    const pending = pendingActions.get(identity.sessionId) ?? { document };
    pending.document = document;
    const candidateId = pending.itemId ?? identity.itemId;
    const existingId = candidateId.startsWith("new:") ? undefined : candidateId;
    const existing = existingId
      ? await getTypedActionCatalogItem(intent, existingId)
      : null;
    const logicalKey =
      existing?.logical_key ?? `local:${intent}:${slug(document.name)}`;
    const { companionName, descriptor } = actionDescriptorFor(
      document,
      logicalKey,
    );
    const file =
      document.implementation === "vrma"
        ? pending.file
        : new File(
            [JSON.stringify(document.sequence, null, 2) + "\n"],
            companionName,
            { type: "application/json" },
          );
    if (!file)
      throw contentSaveFieldError("Choose a VRMA file before saving.", "files");
    const saved = await saveCatalogItem({
      kind: intent,
      entryName: document.name,
      files: [file],
      companionPaths: [companionName],
      descriptor,
      catalogItemId: existing?.item_id,
      expectedRevision:
        existing?.revision_sha256 ?? pending.expectedRevision ?? undefined,
    });
    pending.itemId = saved.item_id;
    pending.expectedRevision = saved.revision_sha256;
    pending.savedItemId = saved.item_id;
    pending.savedRevision = saved.revision_sha256;
    pendingActions.set(identity.sessionId, pending);
    await invalidate();
    return saved;
  }

  const beginSession = useMutation<
    EditSessionIdentity,
    Error,
    { document: ActionDocument; operationId: string; itemId?: string }
  >({
    mutationFn: async ({ document, operationId, itemId }) => {
      const existing = itemId
        ? await getTypedActionCatalogItem(intent, itemId)
        : null;
      const identity = {
        itemId: itemId ?? `new:${operationId}`,
        itemRevision: existing?.revision_sha256 ?? null,
        sessionId: operationId,
        sessionRevision: 1,
      };
      pendingActions.set(operationId, {
        document,
        itemId,
        expectedRevision: existing?.revision_sha256,
      });
      return identity;
    },
  });

  const updateSession = useMutation<
    EditSessionIdentity,
    Error,
    { identity: EditSessionIdentity; document: ActionDocument }
  >({
    mutationFn: async ({ identity, document }) => {
      const pending = pendingActions.get(identity.sessionId) ?? {
        document,
        itemId: identity.itemId,
        expectedRevision: identity.itemRevision,
      };
      pending.document = document;
      pending.savedItemId = undefined;
      pending.savedRevision = undefined;
      pendingActions.set(identity.sessionId, pending);
      return { ...identity, sessionRevision: identity.sessionRevision + 1 };
    },
  });

  const starterPreview = useMutation<
    PyActionPreview,
    Error,
    { source: PyExactContentSource }
  >({
    mutationFn: async ({ source }) => {
      let itemId: string | null = null;
      if (source.type === "catalog") itemId = source.catalog_item_id;
      else {
        const items = await listCatalogItems(intent);
        itemId =
          items.find((item) => item.logical_key === source.content_id)
            ?.item_id ?? null;
      }
      if (!itemId) throw new Error("The selected content is unavailable.");
      return previewSavedAction(itemId);
    },
  });

  const stageFile = useMutation<
    PyContentFile,
    Error,
    {
      sessionId: string;
      file: File;
      role: "sequence" | "animation";
      sha256: string;
    }
  >({
    mutationFn: async ({ sessionId, file, role, sha256 }) => {
      const pending = pendingActions.get(sessionId);
      if (!pending) throw new Error("The editable content session expired.");
      pending.file = file;
      pending.savedItemId = undefined;
      pending.savedRevision = undefined;
      pendingActions.set(sessionId, pending);
      return {
        file_ref: `pending:${sessionId}`,
        relative_path: file.name,
        role,
        ordinal: 1,
        filename: file.name,
        media_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        sha256,
      };
    },
  });

  const save = useMutation<
    PyGesture | PyReaction,
    Error,
    { identity: EditSessionIdentity }
  >({
    mutationFn: async ({ identity }) => {
      const pending = pendingActions.get(identity.sessionId);
      if (!pending) throw new Error("The editable content session expired.");
      const saved =
        pending.savedItemId && pending.savedRevision
          ? await getTypedActionCatalogItem(intent, pending.savedItemId)
          : await persist(identity, pending.document);
      return catalogViewItem(saved) as PyGesture | PyReaction;
    },
    onSuccess: invalidate,
  });

  return {
    beginSession,
    updateSession,
    starterPreview,
    stageFile,
    save,
  };
}

export type { EditSessionIdentity };
