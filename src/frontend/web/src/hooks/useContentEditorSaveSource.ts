import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import {
  catalogViewItem,
  type PyCatalogViewItem,
  type PyContentItem,
} from "@/lib/content/catalogTypes";
import { contentEditorSaveTarget } from "@/lib/content/contentEditorSource";

const families = {
  particle_effect: queryKeys.particleEffects,
  avatar_effect: queryKeys.avatarEffects,
  scene_effect: queryKeys.sceneEffects,
  sound_effect: queryKeys.soundEffects,
};

type EditSession = {
  kind: keyof typeof families;
  owner: string | null;
  routeItemId: string | undefined;
  item: PyCatalogViewItem | undefined;
};

/** Pin conflict authority to the open draft; only its own save advances the revision. */
export function useContentEditorSaveSource(
  kind: keyof typeof families,
  itemId: string | undefined,
  existing: PyCatalogViewItem | undefined,
) {
  const queryClient = useQueryClient();
  const owner = useRuntimeOwnerId();
  const sessionRef = useRef<EditSession | null>(null);
  let session = sessionRef.current;
  if (
    !session ||
    session.kind !== kind ||
    session.owner !== owner ||
    (session.routeItemId !== itemId && session.item?.item_id !== itemId)
  ) {
    session = {
      kind,
      owner,
      routeItemId: itemId,
      item: existing ? { ...existing } : undefined,
    };
    sessionRef.current = session;
  } else {
    // Copy navigation changes the route to the already acknowledged Local item.
    session.routeItemId = itemId;
    // The detail query may first resolve after the initial render. Later catalog
    // refreshes must not grant an older draft authority over another writer's edit.
    if (!session.item && existing) session.item = { ...existing };
  }
  const editSession = session;
  const keys = families[kind];
  return {
    target(name: string) {
      return contentEditorSaveTarget(editSession.item, kind, name);
    },
    async saved(item: PyContentItem) {
      const saved = catalogViewItem(item);
      editSession.item = saved;
      if (!owner) return;
      const detailKey = keys.detail(owner, item.item_id);
      await queryClient.cancelQueries({ queryKey: detailKey, exact: true });
      queryClient.setQueryData(detailKey, saved);
      // Lists refresh independently; detail refresh must never rehydrate a draft.
      void queryClient.invalidateQueries({
        queryKey: keys.all(owner),
        predicate: (query) => query.queryKey[2] !== "detail",
      });
    },
  };
}
