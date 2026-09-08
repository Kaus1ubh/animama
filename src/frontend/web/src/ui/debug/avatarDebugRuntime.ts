import type { ActiveAnimationInfo, AvatarPlannerOutput } from "@/lib/avatar";
import { useAnimationDebugStore } from "@/stores/animation-debug-store";
import {
  useAnimaAnimationDebugStore,
  type AnimaAnimationActionDebug,
  type AnimaAnimationPlanDebug,
} from "@/stores/anima-animation-debug-store";
import { useAvatarRuntimeStore } from "@/stores/avatar-runtime-store";
import {
  useVRMEditorDebugStore,
  type VRMEditorDebugTarget,
} from "@/stores/vrm-editor-debug-store";
import { isAnimaDebugProducerEnabled } from "./animaDebugPanelConfig";

function toAnimaAnimationPlanDebug(
  output: AvatarPlannerOutput | null,
): AnimaAnimationPlanDebug | null {
  const plan = output?.state.activeGestureVrma ?? output?.state.activeBaseVrma;
  if (!plan) return null;
  return {
    key: plan.key,
    state: plan.state,
    gestureRequestId: plan.gestureRequestId,
    clipName: plan.clipName,
    clipUrl: plan.clipUrl,
    loopType: plan.loopType,
    loopCount: plan.loopCount,
    timeScale: plan.timeScale,
    crossFadeSec: plan.crossFadeSec,
    isGesture: plan.isGesture,
    durationSec: plan.durationSec,
    effectiveDurationSec: plan.effectiveDurationSec,
    nextEvalMs: plan.nextEvalMs,
  };
}

function toAnimaAnimationActionDebug(
  item: ActiveAnimationInfo,
): AnimaAnimationActionDebug {
  return {
    name: item.name,
    isCurrent: item.isCurrent,
    loopType: item.loopType,
    weight: item.weight,
    blendMode: item.blendMode,
    timeScale: item.timeScale,
    additiveReference: item.additiveReference,
    clipDurationSec: item.clipDurationSec,
    playheadSec: item.playheadSec,
    effectiveDurationSec: item.durationSec,
  };
}

/** Attach optional inspectors without coupling their state to the model's lifetime. */
export function attachAvatarDebugRuntime(
  target: VRMEditorDebugTarget,
  getPlan: () => AvatarPlannerOutput | null,
): () => void {
  const { avatar, animaId } = target;
  useVRMEditorDebugStore.getState().registerTarget(target);
  useAnimationDebugStore.getState().registerTarget(target);
  useAnimaAnimationDebugStore.getState().clearSnapshot();
  let timer: ReturnType<typeof setInterval> | undefined;
  const publish = () => {
    if (!avatar.isReady) return;
    const activeActions = avatar
      .getActiveAnimations()
      .map(toAnimaAnimationActionDebug);
    useAnimaAnimationDebugStore.getState().setSnapshot({
      animaId,
      updatedAtMs: Date.now(),
      avatarState: avatar.getState(),
      plan: toAnimaAnimationPlanDebug(getPlan()),
      currentAction: activeActions.find((action) => action.isCurrent) ?? null,
      activeActions,
      runtimeVfx: useAvatarRuntimeStore.getState().runtimeVfx,
    });
  };
  const syncDemand = () => {
    const enabled =
      isAnimaDebugProducerEnabled("animationSnapshot") &&
      useAnimaAnimationDebugStore.getState().animationSnapshotDemand;
    if (enabled && timer === undefined) {
      timer = setInterval(publish, 500);
      publish();
    } else if (!enabled && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
  const unsubscribeDemand = useAnimaAnimationDebugStore.subscribe(syncDemand);
  const syncFace = () =>
    avatar.setFaceDebugBoxVisible(
      useVRMEditorDebugStore.getState().showFaceDebugBox,
    );
  const unsubscribeFace = useVRMEditorDebugStore.subscribe(syncFace);
  syncDemand();
  syncFace();
  return () => {
    unsubscribeDemand();
    unsubscribeFace();
    clearInterval(timer);
    avatar.setFaceDebugBoxVisible(false);
    if (useAnimationDebugStore.getState().target?.avatar === avatar)
      useAnimaAnimationDebugStore.getState().clearSnapshot();
    useVRMEditorDebugStore.getState().clearTarget(avatar);
    useAnimationDebugStore.getState().clearTarget(avatar);
  };
}
