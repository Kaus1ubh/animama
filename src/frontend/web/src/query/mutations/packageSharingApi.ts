import {
  allocatePackageImportV1ContentPackageImportsPost as allocate,
  commitPackageImportV1ContentPackageImportsStageIdCommitPost as commit,
  discardPackageExportV1ContentPackageExportsExportIdDelete as discardExport,
  discardPackageImportV1ContentPackageImportsStageIdDelete as discard,
  getPackageImportV1ContentPackageImportsStageIdGet as status,
  getPackageOperationV1ContentPackageOperationsOperationIdGet as operation,
  preparePackageExportV1ContentPackageExportsPost as prepare,
  reviewPackageImportV1ContentPackageImportsStageIdReviewPost as review,
  summarizePackageExportV1ContentPackageExportsSummaryPost as summary,
  uploadPackagePartV1ContentPackageImportsStageIdPartsIndexPut as part,
} from "@animama/runtime-contracts/sdk";
import type { PackageSelectionRequest } from "@animama/runtime-contracts/api-types";
import type { ImportApi } from "@/lib/content-sharing/importSession";
import { SharingError } from "@/lib/content-sharing/errors";
import { parseContentApiErrorDetail } from "@/lib/content/contentSaveErrors";

const options = {
  requestValidator: undefined,
  responseValidator: undefined,
  throwOnError: false as const,
};
/** Generated operations preserve same-origin admission; errors expose only safe stable codes. */
async function value<T>(
  request: Promise<{ data?: T; error?: unknown; response?: Response }>,
): Promise<T> {
  let result;
  try {
    result = await request;
  } catch {
    throw new SharingError("package_transport_unavailable");
  }
  // A rejected fetch is returned without a Response by the generated client.
  // Keep that uncertainty recoverable instead of dereferencing an absent HTTP result.
  if (!result.response) throw new SharingError("package_transport_unavailable");
  if (!result.response.ok)
    throw new SharingError(
      parseContentApiErrorDetail(result.error)?.code ??
        "package_operation_unknown",
      result.response.status,
      errorItems(result.error),
    );
  return result.data as T;
}
/** Item display names in `detail.items`, ignoring anything that is not a string. */
function errorItems(error: unknown): string[] {
  const detail = (error as { detail?: { items?: unknown } } | null)?.detail;
  return Array.isArray(detail?.items)
    ? detail.items.filter((item): item is string => typeof item === "string")
    : [];
}
const timeout = () => AbortSignal.timeout(120_000);
export const packageImportApi: ImportApi = {
  allocate: (file, id) =>
    value(
      allocate({
        ...options,
        signal: timeout(),
        body: {
          operation_id: id,
          filename: file.name,
          expected_size_bytes: file.size,
        },
      }),
    ),
  status: (id) =>
    value(status({ ...options, signal: timeout(), path: { stage_id: id } })),
  part: (id, index, bytes, signal) =>
    value(
      part({
        ...options,
        signal: AbortSignal.any([signal, timeout()]),
        path: { stage_id: id, index },
        body: bytes,
      }),
    ),
  review: (id) =>
    value(review({ ...options, signal: timeout(), path: { stage_id: id } })),
  commit: (id, operationId, digest) =>
    value(
      commit({
        ...options,
        signal: timeout(),
        path: { stage_id: id },
        body: { operation_id: operationId, review_digest: digest },
      }),
    ),
  operation: (id) =>
    value(
      operation({ ...options, signal: timeout(), path: { operation_id: id } }),
    ),
  discard: async (id) => {
    await value(
      discard({ ...options, signal: timeout(), path: { stage_id: id } }),
    );
  },
};
export const packageExportApi = {
  summary: (selection: PackageSelectionRequest, signal: AbortSignal) =>
    value(
      summary({
        ...options,
        signal: AbortSignal.any([signal, timeout()]),
        body: selection,
      }),
    ),
  prepare: (selection: PackageSelectionRequest, digest: string) =>
    value(
      prepare({
        ...options,
        signal: timeout(),
        body: { ...selection, expected_digest: digest },
      }),
    ),
  discard: async (id: string) => {
    await value(
      discardExport({ ...options, signal: timeout(), path: { export_id: id } }),
    );
  },
};
