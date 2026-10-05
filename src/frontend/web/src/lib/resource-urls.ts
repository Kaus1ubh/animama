declare const __ANIMAMA_LAZY_RESOURCE_PREFIXES__:
  | Record<string, string>
  | undefined;

/** Build-owned public bytes; private API and user-file URLs never pass here. */
export function publicResourceUrl(relative: string): string {
  return `${import.meta.env.BASE_URL ?? "/"}${relative.replace(/^\//, "")}`;
}

/** An optional model's exact catalog address; local delivery retains its existing URL. */
export function optionalModelResourceUrl(
  id: string,
  file: string,
  localUrl: string,
): string {
  const prefix =
    typeof __ANIMAMA_LAZY_RESOURCE_PREFIXES__ === "object"
      ? __ANIMAMA_LAZY_RESOURCE_PREFIXES__?.[id]
      : undefined;
  return prefix ? `${prefix}${file}` : localUrl;
}
