import type {
  ContentKind,
  PyCatalogViewItem,
  PyContentPreview,
} from "./catalogTypes";
import { localContentLogicalKey } from "./catalogApi";
import { contentPreviewPrimaryFile } from "./contentPreview";
import { PreviewByteSession } from "@/lib/runtime-content/PreviewByteSession";

/** Included editor sources create Local content; only Local sources carry update authority. */
export function contentEditorSaveTarget(
  item: PyCatalogViewItem | undefined,
  kind: ContentKind,
  name: string,
) {
  const local = item?.origin === "owned" ? item : undefined;
  return {
    logicalKey: local?.logical_key ?? localContentLogicalKey(kind, name),
    catalogItemId: local?.item_id,
    expectedRevision: local?.revision_sha256,
  };
}

/** Hydrate a creator's existing binary input through the same verified preview lease. */
export async function loadCreatorPreviewFile(
  preview: PyContentPreview,
  role: string,
  signal?: AbortSignal,
): Promise<File> {
  const file = contentPreviewPrimaryFile(preview, role);
  if (!file) throw new Error(`The selected content has no ${role} file.`);
  const source = preview.files.find(
    (candidate) => candidate.file_ref === file.file_ref,
  )!;
  const session = await PreviewByteSession.prepare(
    { ...preview, files: [source] },
    { signal },
  );
  try {
    const loaded = session.files.get(file.file_ref);
    if (!loaded) throw new Error(`The selected ${role} file is unavailable.`);
    signal?.throwIfAborted();
    return new File([loaded.blob], file.filename, { type: file.media_type });
  } finally {
    session.dispose();
  }
}

/** One hydration per selected document; unfinished canceled loads remain retryable. */
export class ContentEditorHydration {
  private current: { itemId: string; complete: boolean } | null = null;

  begin(itemId: string) {
    if (this.current?.itemId === itemId) return null;
    const load = { itemId, complete: false };
    this.current = load;
    return {
      complete: () => {
        if (this.current === load) load.complete = true;
      },
      cancel: () => {
        if (this.current === load && !load.complete) this.current = null;
      },
    };
  }

  /** A successful copy already has an open draft when its Local route appears. */
  preserve(itemId: string) {
    this.current = { itemId, complete: true };
  }
}
