export type UnifiedDiffLineKind =
  | "file"
  | "hunk"
  | "add"
  | "remove"
  | "context"
  | "meta";

export type UnifiedDiffLine = {
  id: string;
  kind: UnifiedDiffLineKind;
  content: string;
};

export function parseUnifiedDiff(diff: string | null | undefined) {
  const trimmed = diff?.trimEnd() ?? "";
  if (!trimmed) return [];

  return trimmed.split(/\r?\n/).map((line, index): UnifiedDiffLine => {
    const id = `${index}:${line}`;
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      return { id, kind: "file", content: line };
    }
    if (line.startsWith("@@")) {
      return { id, kind: "hunk", content: line };
    }
    if (line.startsWith("+")) {
      return { id, kind: "add", content: line };
    }
    if (line.startsWith("-")) {
      return { id, kind: "remove", content: line };
    }
    if (line.startsWith(" ")) {
      return { id, kind: "context", content: line };
    }
    return { id, kind: "meta", content: line };
  });
}
