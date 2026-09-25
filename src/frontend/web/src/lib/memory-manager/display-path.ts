import type { PyMemoryPatchPreview } from "@/lib/content/catalogTypes";

/**
 * Shows a Memory Manager preview under its owner-facing path. Identity
 * proposals target `animas/<anima_id>/IDENTITY.md`; the header, summary and
 * unified-diff file lines should read `Animas/<name>/IDENTITY.md` instead.
 */
export function previewWithDisplayPath<
  T extends Pick<PyMemoryPatchPreview, "path" | "summary" | "unified_diff">,
>(preview: T, displayPath: string | undefined): T {
  if (!displayPath || displayPath === preview.path) return preview;
  const relabel = (text: string) => text.split(preview.path).join(displayPath);
  return {
    ...preview,
    path: displayPath,
    summary: preview.summary ? relabel(preview.summary) : preview.summary,
    unified_diff: relabel(preview.unified_diff),
  };
}
