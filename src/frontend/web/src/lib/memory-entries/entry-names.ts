/** Normalizes a user-entered entry name for the requested filesystem type. */
export function normalizeMemoryEntryName(
  name: string,
  type: "file" | "directory",
) {
  const trimmed = name.trim();
  if (!trimmed || type === "directory" || trimmed.endsWith(".md")) {
    return trimmed;
  }
  return `${trimmed}.md`;
}

/** Returns the leaf Markdown stem for a relative file path. */
export function memoryFileStemFromPath(path: string) {
  const fileName = path.split("/").pop() ?? path;
  return fileName.replace(/\.md$/i, "");
}

/** Selects the editable stem while leaving a Markdown extension visible. */
export function memoryEntryNameSelectionEnd(
  name: string,
  type: "file" | "directory",
) {
  return type === "file" && name.endsWith(".md")
    ? name.length - ".md".length
    : name.length;
}
