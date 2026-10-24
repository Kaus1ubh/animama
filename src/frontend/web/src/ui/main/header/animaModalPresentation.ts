/** A side panel never recenters the profile or extends beyond the viewport. */
export function canShowEmotionPopout(
  profileRight: number,
  viewportWidth: number,
) {
  return viewportWidth >= 768 && profileRight + 16 + 360 + 16 <= viewportWidth;
}

/** A matching chat runtime wins even when its state is neutral or missing. */
export function selectHeaderEmotionState({
  isChatRoute,
  currentAnimaId,
  runtimeAnimaId,
  runtimeState,
  persistedState,
}: {
  isChatRoute: boolean;
  currentAnimaId: string | null;
  runtimeAnimaId: string | null;
  runtimeState: unknown;
  persistedState: unknown;
}) {
  const live =
    isChatRoute && Boolean(currentAnimaId) && runtimeAnimaId === currentAnimaId;
  return {
    state: live ? runtimeState : (persistedState ?? null),
    sourceLabel: live ? "Live runtime state" : "Persisted anima state",
    /** The state follows the chat runtime, so its reactions can be shown. */
    live,
  };
}
