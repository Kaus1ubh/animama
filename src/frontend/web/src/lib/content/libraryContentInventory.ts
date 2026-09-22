import type { ContentLibrarySearch } from "./librarySearch";

export type LibraryInventoryGroup =
  | "avatars"
  | "gestures"
  | "reactions"
  | "poses"
  | "particle"
  | "avatar-effects"
  | "scene"
  | "sound";

/** Each product family owns its own query and cursor even on the All page. */
export function contentInventoryGroups(
  search: ContentLibrarySearch,
): LibraryInventoryGroup[] {
  if (search.section === "avatars") return ["avatars"];
  if (search.section === "actions") {
    if (search.action === "gestures") return ["gestures"];
    if (search.action === "reactions") return ["reactions"];
    if (search.action === "poses") return ["poses"];
    return ["gestures", "reactions", "poses"];
  }
  if (search.section === "fx") {
    if (search.fx === "particle") return ["particle"];
    if (search.fx === "avatar") return ["avatar-effects"];
    if (search.fx === "scene") return ["scene"];
    if (search.fx === "sound") return ["sound"];
    return ["particle", "avatar-effects", "scene", "sound"];
  }
  if (search.section === "chat-uploads") return [];
  return [
    "avatars",
    "gestures",
    "reactions",
    "poses",
    "particle",
    "avatar-effects",
    "scene",
    "sound",
  ];
}
