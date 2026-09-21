import { usePoseCreatorStore } from "@/stores/pose-creator-store";

export type PendingCatalogSelection = { id: string; session: number };

/** Effects arrive through document hydration; never select in another session/mode. */
export function selectHydratedCatalogEvent(
  pending: PendingCatalogSelection | null,
  session: number,
  enabled: boolean,
): boolean {
  if (!enabled || !pending || pending.session !== session) return false;
  const state = usePoseCreatorStore.getState();
  if (!state.clipDraft.events.some((event) => event.id === pending.id))
    return false;
  state.selectClipKeyframe(null);
  state.selectClipEvent(pending.id);
  return true;
}
