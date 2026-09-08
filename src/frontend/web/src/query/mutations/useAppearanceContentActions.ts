"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { saveCatalogItem } from "@/lib/content/catalogApi";
import { catalogViewItem } from "@/lib/content/catalogTypes";
import { contentSaveFieldError } from "@/lib/content/contentSaveErrors";
import { preflightContentFile } from "@/lib/content/contentUploads";
import { queryKeys } from "@/query/keys";

export type AppearanceUploadProgress = {
  stage: "preparing" | "hashing" | "uploading" | "processing";
  percent: number | null;
};

export type AppearanceImageSaveInput = {
  name: string;
  file: File;
  uses: Array<"profile" | "background">;
  operationId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: AppearanceUploadProgress) => void;
};

function logicalName(value: string): string {
  return (
    value
      .trim()
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "image"
  );
}

async function imageSize(
  file: File,
): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap !== "function") return { width: 0, height: 0 };
  const bitmap = await createImageBitmap(file);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** Save one ordinary image plus a readable sidecar into content/local. */
export async function saveAppearanceImage(input: AppearanceImageSaveInput) {
  input.onProgress?.({ stage: "preparing", percent: null });
  const preflight = await preflightContentFile("image", input.file);
  if (preflight.error) throw contentSaveFieldError(preflight.error, "files");
  if (input.signal?.aborted)
    throw new DOMException("Save cancelled.", "AbortError");
  input.onProgress?.({ stage: "hashing", percent: 100 });
  const dimensions = await imageSize(input.file);
  input.onProgress?.({ stage: "uploading", percent: 0 });
  const saved = await saveCatalogItem({
    kind: "appearance",
    entryName: input.name,
    files: [input.file],
    operationId: input.operationId,
    metadata: {
      schema_version: 1,
      id: `local:appearance:${logicalName(input.name)}`,
      name: input.name,
      supported_uses: input.uses,
      ...dimensions,
    },
  });
  input.onProgress?.({ stage: "uploading", percent: 100 });
  input.onProgress?.({ stage: "processing", percent: null });
  return { item: catalogViewItem(saved), itemId: saved.item_id };
}

export function useAppearanceContentActions() {
  const queryClient = useQueryClient();
  const userId = useRuntimeOwnerId();
  const createAppearanceImage = useMutation({
    mutationFn: saveAppearanceImage,
    onSuccess: async () => {
      if (!userId) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.appearanceImages.all(userId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.content.catalog(userId),
        }),
      ]);
    },
  });
  return { createAppearanceImage };
}
