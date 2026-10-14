import { disposePocketTtsRuntime } from "@/hooks/use-pocket-tts-runtime";
import { clearVrmaCache } from "@/lib/avatar";
import { terminateVisemeWorker } from "@/lib/avatar/viseme-worker-client";
import { terminateLipSyncWorker } from "@/lib/lipsync/lipsync-worker-client";
import { terminateClientParakeetWorker } from "@/lib/speech/client-parakeet/client";
import { terminateSmartTurnWorker } from "@/lib/voice/smart-turn-worker-client";
import { useAvatarRuntimeStore } from "@/stores/avatar-runtime-store";
import { useAvatarLipSyncBridgeStore } from "@/stores/avatar-lipsync-bridge-store";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { useVoiceVadDebugStore } from "@/stores/voice-vad-debug-store";
import { useVRMEditorDebugStore } from "@/stores/vrm-editor-debug-store";
import { useAnimaAnimationDebugStore } from "@/stores/anima-animation-debug-store";
import { useAnimationDebugStore } from "@/stores/animation-debug-store";
import { useSceneVFXStore } from "@/stores/scene-vfx-store";
import { endHostedRecoverySession } from "@/lib/content/recovery-session";
import { privateStateResets } from "./private-module-state";

/** Private module state ends with admission; browser device preferences and model stores survive. */
export async function clearPrivateSessionState(
  sessionKey: string,
  clearRecovery = false,
): Promise<void> {
  // Fence writes before module disposal or React unmount can run a final recovery callback.
  const recoveryCleanup = clearRecovery
    ? endHostedRecoverySession(sessionKey)
    : Promise.resolve();
  const errors: unknown[] = [];
  // One failing resource must not retain the rest of the former account's state.
  const disposals = [
    disposePocketTtsRuntime,
    terminateVisemeWorker,
    terminateLipSyncWorker,
    // Synchronous: the session also terminates these workers, so an awaited
    // dispose reply could never arrive and would leave a dead worker behind.
    terminateClientParakeetWorker,
    terminateSmartTurnWorker,
    clearVrmaCache,
    () => useAvatarRuntimeStore.getState().resetForAnima(null),
    () =>
      useAvatarLipSyncBridgeStore
        .getState()
        .clearAll({ clearAvatarLipSync: true }),
    () => usePoseCreatorStore.getState().activeAvatar?.dispose(),
    () => usePoseCreatorStore.getState().resetWorkspace(),
    () => useVRMEditorDebugStore.getState().target?.avatar.dispose(),
    () => useVRMEditorDebugStore.getState().clearTarget(),
    () => useAnimationDebugStore.getState().clearTarget(),
    () => useAnimaAnimationDebugStore.getState().clearSnapshot(),
    () => useVoiceVadDebugStore.getState().reset(),
    () => useSceneVFXStore.getState().clearAllSceneVFX(),
    // Module-level drafts of lazily loaded features (pending saves, staged files).
    ...privateStateResets(),
  ];
  for (const dispose of disposals) {
    try {
      dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  if (typeof window !== "undefined") {
    if (window.document.pictureInPictureElement)
      void window.document.exitPictureInPicture().catch(() => {});
  }
  try {
    await recoveryCleanup;
  } catch (error) {
    errors.push(error);
  }
  if (errors.length)
    throw new AggregateError(
      errors,
      "Private session state could not all be disposed",
    );
}
