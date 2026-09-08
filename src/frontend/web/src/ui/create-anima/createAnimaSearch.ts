import { itemIdSchema } from "./createAnimaDraft";

/** Only a logical catalog identifier crosses the route boundary, never a path or URL. */
export function parseCreateAnimaSearch(search: Record<string, unknown>): {
  avatar?: string;
} {
  const result = itemIdSchema.safeParse(
    typeof search.avatar === "string" ? search.avatar.trim() : undefined,
  );
  return { avatar: result.success ? result.data : undefined };
}
