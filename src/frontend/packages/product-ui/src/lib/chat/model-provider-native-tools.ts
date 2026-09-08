import type { PyModelProviderCatalogItem } from "@animama/runtime-contracts/api-types";

function normalizedTools(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

/** Returns native tools callers may explicitly select for a catalog row. */
export function requestableNativeTools(
  item: PyModelProviderCatalogItem | null | undefined,
): string[] {
  return normalizedTools(item?.requestable_native_tool_support);
}

/** Drops stale or internal tool names before they enter a chat request. */
export function filterRequestableNativeTools(
  requestedTools: unknown,
  supportedTools: unknown,
): string[] {
  const supported = new Set(normalizedTools(supportedTools));
  return normalizedTools(requestedTools).filter((tool) => supported.has(tool));
}
