import type { PyTypedContentPreview } from "@animama/runtime-contracts/api-types";

type TypedPreviewItem = PyTypedContentPreview["item"];

type FileIdentity = {
  file_ref?: string;
  role: string;
  ordinal: number;
};

const NON_RESOURCE_ROLES = new Set(["descriptor", "manifest", "metadata"]);

/**
 * Preserve the item-relative names referenced inside typed VFX documents.
 *
 * Opaque file refs are the stable transport identity. Role/ordinal remains in
 * the projection for compatibility with previews issued before logical paths
 * became part of the typed contract.
 */
export function typedLogicalResourceFiles(
  item: TypedPreviewItem,
): Record<string, { file_ref: string; role: string; ordinal: number }> {
  return Object.fromEntries(
    (item.files ?? []).flatMap((file) =>
      file.logical_path && !NON_RESOURCE_ROLES.has(file.role)
        ? [
            [
              file.logical_path,
              {
                file_ref: file.file_ref,
                role: file.role,
                ordinal: file.ordinal,
              },
            ],
          ]
        : [],
    ),
  );
}

/** Resolve a logical resource by opaque ref, with role/ordinal compatibility. */
export function findLogicalResourceFile<T extends FileIdentity>(
  files: readonly T[],
  identity: Record<string, unknown>,
): T | undefined {
  const fileRef =
    typeof identity.file_ref === "string" ? identity.file_ref : null;
  if (fileRef !== null) {
    return files.find((file) => file.file_ref === fileRef);
  }
  return files.find(
    (file) =>
      file.role === identity.role && file.ordinal === Number(identity.ordinal),
  );
}
