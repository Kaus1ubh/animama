"use client";

import { abortAnimaVoiceCatalogUploadV1AnimasVoiceCatalogsUploadsUploadIdDelete } from "@animama/runtime-contracts/sdk";

export const MAX_POCKET_VOICE_CATALOG_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

export async function abortAnimaVoiceCatalogUploadBestEffort(
  uploadId: string,
): Promise<void> {
  try {
    await abortAnimaVoiceCatalogUploadV1AnimasVoiceCatalogsUploadsUploadIdDelete(
      {
        path: {
          upload_id: uploadId,
        },
        responseValidator: undefined,
        throwOnError: true,
      },
    );
  } catch {
    // Cleanup will be retried by the backend worker if abort fails.
  }
}
