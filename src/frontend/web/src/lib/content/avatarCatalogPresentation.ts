import type { PyAvatarResponse } from "@/lib/content/catalogTypes";

export type AvatarCatalogPresentation = {
  avatarId: string;
  name: string;
  origin: "builtin" | "owned";
  exactSource:
    | { type: "builtin"; avatar_id: string; version: number }
    | {
        type: "catalog";
        avatar_id: string;
        catalog_item_id: string;
      };
  ready: boolean;
  presentationRevision: number;
};

/** Project an Avatar's neutral Included or catalog source for product UI. */
export function avatarCatalogPresentation(
  avatar: PyAvatarResponse,
): AvatarCatalogPresentation {
  const owned = "catalog_item_id" in avatar.source;
  return {
    avatarId: avatar.id,
    name: avatar.name,
    origin: owned ? "owned" : "builtin",
    exactSource:
      "catalog_item_id" in avatar.source
        ? {
            type: "catalog",
            avatar_id: avatar.id,
            catalog_item_id: avatar.source.catalog_item_id,
          }
        : {
            type: "builtin",
            avatar_id: avatar.id,
            version: avatar.source.version ?? 1,
          },
    ready: !owned || Boolean(avatar.catalog_item_id),
    presentationRevision: avatar.presentation_revision ?? 1,
  };
}
