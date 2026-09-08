import { useAvatarRuntimeStore } from "@/stores/avatar-runtime-store";

/**
 * Start a non-TTS debug run through the same store and planner path as chat.
 * A live chat run is never replaced; callers receive null while one is active.
 */
export function startPlannerGestureDebugRun(
  gestureId: string,
  runId = `animation-debug:${Date.now().toString(36)}`,
): string | null {
  const normalizedGestureId = gestureId.trim();
  const current = useAvatarRuntimeStore.getState();
  if (!normalizedGestureId || current.activeRunId) return null;

  current.startRun(runId, {
    inputText: `Animation Debug Gesture: ${normalizedGestureId}`,
    thinkingPoseDwellMs: 0,
  });
  useAvatarRuntimeStore.getState().markNonTtsResponseStarted(runId);
  useAvatarRuntimeStore.getState().requestGesture({
    eventId: `${runId}:gesture`,
    runId,
    gesture: normalizedGestureId,
  });
  useAvatarRuntimeStore.getState().requestNonTtsResponseCompletion(runId);
  return runId;
}
