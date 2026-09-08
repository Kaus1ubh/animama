import type * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";

import { BreathingProceduralAnimationLayer } from "./proc-animation/BreathingProceduralAnimationLayer";
import { BounceProceduralAnimationLayer } from "./proc-animation/BounceProceduralAnimationLayer";
import { CursorLookAtProceduralAnimationLayer } from "./proc-animation/CursorLookAtProceduralAnimationLayer";
import { EmotionPostureProceduralAnimationLayer } from "./proc-animation/EmotionPostureProceduralAnimationLayer";
import { HeadNodProceduralAnimationLayer } from "./proc-animation/HeadNodProceduralAnimationLayer";
import { HeadSideTiltProceduralAnimationLayer } from "./proc-animation/HeadSideTiltProceduralAnimationLayer";
import { SwayProceduralAnimationLayer } from "./proc-animation/SwayProceduralAnimationLayer";
import { TalkingHandsProceduralAnimationLayer } from "./proc-animation/TalkingHandsProceduralAnimationLayer";
import type {
  CursorLookAtInputProvider,
  ProceduralAnimationLayer,
  ProceduralAnimationLayerId,
  ProceduralAnimationLayerParamsById,
  ProceduralAnimationRuntimeContext,
  ProceduralAnimationSnapshot,
  ProceduralAnimationTransitionState,
  TalkingHandsPlayGroupRequest,
} from "./proc-animation/types";

export type ProceduralAnimationControllerOptions = {
  camera?: THREE.Object3D | null;
  cursorLookAtInputProvider?: CursorLookAtInputProvider | null;
  isVrm0?: boolean;
  viewportElement?: HTMLElement | null;
};

export type {
  BounceProceduralAnimationParams,
  BreathingProceduralAnimationParams,
  CursorLookAtInputProvider,
  CursorLookAtInputSnapshot,
  CursorLookAtProceduralAnimationParams,
  EmotionPostureProceduralAnimationParams,
  EmotionPostureDebugSnapshot,
  EmotionPostureGroup,
  EmotionPostureLevel,
  EmotionPostureLevelIntensities,
  EmotionPosturePresetMap,
  EmotionPosturePresetParams,
  EmotionPostureResolutionReason,
  EmotionPostureTarget,
  HeadNodProceduralAnimationParams,
  HeadSideTiltProceduralAnimationParams,
  ProceduralAnimationLayerId,
  ProceduralAnimationLayerParamsById,
  ProceduralAnimationLayerSnapshot,
  ProceduralAnimationRuntimeContext,
  ProceduralAnimationSnapshot,
  ProceduralAnimationTransitionState,
  ProceduralSpeechTimingContext,
  SwayProceduralAnimationParams,
  TalkingHandsMicroTwistMode,
  TalkingHandsPlayGroupRequest,
  TalkingHandsProceduralAnimationParams,
  TalkingHandsSecondaryMicroTwistAxis,
} from "./proc-animation/types";
export {
  DEFAULT_BOUNCE_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_BREATHING_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_CURSOR_LOOK_AT_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_EMOTION_POSTURE_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_HEAD_NOD_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_HEAD_SIDE_TILT_PROCEDURAL_ANIMATION_PARAMS,
  SUPPORTED_EMOTION_POSTURE_GROUPS,
  DEFAULT_SWAY_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_TALKING_HANDS_PROCEDURAL_ANIMATION_PARAMS,
  isEmotionPostureGroup,
} from "./proc-animation/types";

const MAX_PROCEDURAL_DELTA_SEC = 1 / 15;
const LAYER_ACTIVATION_BLEND_SEC = 0.28;
const LAYER_ACTIVATION_EPSILON = 0.0001;
const LAYER_NATURAL_DEACTIVATION_MAX_WAIT_SEC = 1.5;

type LayerEnabledSource = "manual" | "plannerPolicy";

export type PlannerProceduralPolicyAction = {
  ownerId: string;
  layerId: ProceduralAnimationLayerId;
  enabled: boolean;
};

export type PlannerProceduralPolicySnapshot = {
  activePlannerProceduralLayerIds: ProceduralAnimationLayerId[];
  manualProceduralLayerIds: ProceduralAnimationLayerId[];
  eligiblePlannerProceduralLayerIds: ProceduralAnimationLayerId[];
};

type LayerActivationState = {
  currentWeight: number;
  targetWeight: number;
  desiredEnabled: boolean;
  physicallyEnabled: boolean;
  naturalDeactivatePending: boolean;
  naturalDeactivateElapsedSec: number;
  naturalDeactivateMaxWaitSec: number;
};

export class ProceduralAnimationController {
  private _vrm: VRM | null;
  private _elapsedSec: number = 0;
  private _isDisposed: boolean = false;
  private _layers = new Map<
    ProceduralAnimationLayerId,
    ProceduralAnimationLayer
  >();
  private _layerActivationStates = new Map<
    ProceduralAnimationLayerId,
    LayerActivationState
  >();
  private _plannerPolicyLayerIds = new Set<ProceduralAnimationLayerId>();

  constructor(vrm: VRM, options: ProceduralAnimationControllerOptions = {}) {
    this._vrm = vrm;
    this._layers.set("breathing", new BreathingProceduralAnimationLayer(vrm));
    this._layers.set("sway", new SwayProceduralAnimationLayer(vrm));
    this._layers.set("bounce", new BounceProceduralAnimationLayer(vrm));
    this._layers.set("headNod", new HeadNodProceduralAnimationLayer(vrm));
    this._layers.set(
      "headSideTilt",
      new HeadSideTiltProceduralAnimationLayer(vrm),
    );
    this._layers.set(
      "cursorLookAt",
      new CursorLookAtProceduralAnimationLayer(vrm, {
        camera: options.camera,
        inputProvider: options.cursorLookAtInputProvider,
        viewportElement: options.viewportElement,
      }),
    );
    this._layers.set(
      "talkingHands",
      new TalkingHandsProceduralAnimationLayer(vrm),
    );
    this._layers.set(
      "emotionPosture",
      new EmotionPostureProceduralAnimationLayer(vrm, {
        isVrm0: options.isVrm0 === true,
      }),
    );
    for (const layer of this._layers.values()) {
      this._layerActivationStates.set(
        layer.id,
        createLayerActivationState(layer.getSnapshot().enabled),
      );
    }
  }

  update(deltaSec: number, context: ProceduralAnimationRuntimeContext): void {
    if (this._isDisposed || !this._vrm) return;

    const clampedDeltaSec = this._clampDelta(deltaSec);
    this._elapsedSec += clampedDeltaSec;

    for (const layer of this._layers.values()) {
      const activation = this._getLayerActivationState(layer);
      this._advancePendingLayerDeactivation(layer, activation, clampedDeltaSec);
      this._advanceLayerActivationState(activation, clampedDeltaSec);
      layer.update(clampedDeltaSec, {
        ...context,
        layerActivationWeight: activation.currentWeight,
        layerDeactivationRequested: !activation.desiredEnabled,
      });
      this._completePendingLayerDeactivationIfReady(layer, activation);
      this._finalizeLayerActivationState(layer, activation);
    }
  }

  clearActiveOffsets(): void {
    if (this._isDisposed) return;
    this._clearLayersInReverseOrder();
  }

  getSnapshot(): ProceduralAnimationSnapshot {
    return {
      ready: Boolean(this._vrm && !this._isDisposed),
      disposed: this._isDisposed,
      elapsedSec: this._elapsedSec,
      maxDeltaSec: MAX_PROCEDURAL_DELTA_SEC,
      layers: Array.from(this._layers.values()).map((layer) => {
        const snapshot = layer.getSnapshot();
        const activation = this._getLayerActivationState(layer);
        return {
          ...snapshot,
          enabled: activation.desiredEnabled,
          params: {
            ...snapshot.params,
            enabled: activation.desiredEnabled,
          },
        };
      }),
    };
  }

  setLayerEnabled(id: ProceduralAnimationLayerId, enabled: boolean): boolean {
    return this._setLayerEnabled(id, enabled, "manual");
  }

  getPlannerPolicySnapshot(): PlannerProceduralPolicySnapshot {
    const activePlannerProceduralLayerIds: ProceduralAnimationLayerId[] = [];
    const manualProceduralLayerIds: ProceduralAnimationLayerId[] = [];
    const eligiblePlannerProceduralLayerIds: ProceduralAnimationLayerId[] = [];

    for (const layer of this._layers.values()) {
      const activation = this._getLayerActivationState(layer);
      if (canStatePolicyActivateLayer(layer)) {
        eligiblePlannerProceduralLayerIds.push(layer.id);
      }
      if (!activation.desiredEnabled) {
        continue;
      }
      if (this._plannerPolicyLayerIds.has(layer.id)) {
        activePlannerProceduralLayerIds.push(layer.id);
      } else {
        manualProceduralLayerIds.push(layer.id);
      }
    }

    return {
      activePlannerProceduralLayerIds,
      manualProceduralLayerIds,
      eligiblePlannerProceduralLayerIds,
    };
  }

  applyPlannerPolicyAction(action: PlannerProceduralPolicyAction): boolean {
    const layer = this._layers.get(action.layerId);
    if (!layer) return false;

    if (action.enabled) {
      const activation = this._getLayerActivationState(layer);
      if (
        activation.desiredEnabled &&
        !this._plannerPolicyLayerIds.has(action.layerId)
      ) {
        return false;
      }
      if (!canStatePolicyActivateLayer(layer)) {
        return false;
      }
      const didApply = this._setLayerEnabled(
        action.layerId,
        true,
        "plannerPolicy",
      );
      if (didApply) {
        this._plannerPolicyLayerIds.add(action.layerId);
      }
      return didApply;
    }

    if (!this._plannerPolicyLayerIds.has(action.layerId)) {
      return true;
    }
    const didApply = this._setLayerEnabled(
      action.layerId,
      false,
      "plannerPolicy",
    );
    this._plannerPolicyLayerIds.delete(action.layerId);
    return didApply;
  }

  private _setLayerEnabled(
    id: ProceduralAnimationLayerId,
    enabled: boolean,
    source: LayerEnabledSource,
  ): boolean {
    const layer = this._layers.get(id);
    if (!layer) return false;
    const activation = this._getLayerActivationState(layer);

    if (source === "manual") {
      this._relinquishPlannerPolicyOwnershipForManualLayerChange(id);
    }

    if (!enabled && !activation.desiredEnabled) return true;

    activation.desiredEnabled = enabled;

    if (enabled) {
      activation.targetWeight = 1;
      activation.naturalDeactivatePending = false;
      activation.naturalDeactivateElapsedSec = 0;
      activation.naturalDeactivateMaxWaitSec = 0;

      if (!activation.physicallyEnabled) {
        activation.currentWeight = 0;
        layer.setEnabled(true);
        activation.physicallyEnabled = true;
      }
      return true;
    }

    this._requestLayerDeactivation(layer, activation);
    return true;
  }

  setLayerWeight(id: ProceduralAnimationLayerId, weight: number): boolean {
    const layer = this._layers.get(id);
    if (!layer) return false;
    this._relinquishPlannerPolicyOwnershipForManualLayerChange(id);
    layer.setWeight(weight);
    return true;
  }

  setLayerParams<TId extends ProceduralAnimationLayerId>(
    id: TId,
    params: Partial<ProceduralAnimationLayerParamsById[TId]>,
  ): boolean {
    const layer = this._layers.get(id) as
      | ProceduralAnimationLayer<TId>
      | undefined;
    if (!layer) return false;
    this._relinquishPlannerPolicyOwnershipForManualLayerChange(id);

    const enabled =
      typeof params.enabled === "boolean" ? params.enabled : undefined;
    const paramsWithoutEnabled = { ...params };
    delete paramsWithoutEnabled.enabled;

    if (Object.keys(paramsWithoutEnabled).length > 0) {
      layer.setParams(paramsWithoutEnabled);
    }
    if (typeof enabled === "boolean") {
      this._setLayerEnabled(id, enabled, "manual");
    }
    return true;
  }

  playTalkingHandsGroup(request: TalkingHandsPlayGroupRequest): boolean {
    const layer = this._layers.get("talkingHands");
    if (!layer?.playGroup) return false;

    if (!this._setLayerEnabled("talkingHands", true, "manual")) {
      return false;
    }
    return layer.playGroup(request);
  }

  reset(id?: ProceduralAnimationLayerId): boolean {
    if (id) {
      const layer = this._layers.get(id);
      if (!layer) return false;
      this._clearLayersInReverseOrder();
      layer.reset();
      this._resetLayerActivationState(layer);
      this._plannerPolicyLayerIds.delete(id);
      return true;
    }

    this._clearLayersInReverseOrder();
    for (const layer of this._layers.values()) {
      layer.reset();
      this._resetLayerActivationState(layer);
    }
    this._plannerPolicyLayerIds.clear();
    return true;
  }

  dispose(): void {
    if (this._isDisposed) return;

    this._clearLayersInReverseOrder();
    for (const layer of this._layers.values()) {
      layer.dispose();
    }
    this._layers.clear();
    this._layerActivationStates.clear();
    this._plannerPolicyLayerIds.clear();
    this._vrm = null;
    this._isDisposed = true;
  }

  private _clampDelta(deltaSec: number): number {
    if (!Number.isFinite(deltaSec) || deltaSec <= 0) return 0;
    return Math.min(deltaSec, MAX_PROCEDURAL_DELTA_SEC);
  }

  private _clearLayersInReverseOrder(): void {
    const layers = Array.from(this._layers.values()).reverse();
    for (const layer of layers) {
      layer.clearOffsets();
    }
  }

  private _relinquishPlannerPolicyOwnershipForManualLayerChange(
    id: ProceduralAnimationLayerId,
  ): void {
    this._plannerPolicyLayerIds.delete(id);
  }

  private _advancePendingLayerDeactivation(
    layer: ProceduralAnimationLayer,
    activation: LayerActivationState,
    deltaSec: number,
  ): void {
    if (!activation.naturalDeactivatePending) return;

    activation.naturalDeactivateElapsedSec += deltaSec;
    if (this._shouldStartLayerDeactivationFade(layer, activation)) {
      this._startLayerDeactivationFade(activation);
    }
  }

  private _completePendingLayerDeactivationIfReady(
    layer: ProceduralAnimationLayer,
    activation: LayerActivationState,
  ): void {
    if (!activation.naturalDeactivatePending) return;

    if (this._shouldStartLayerDeactivationFade(layer, activation)) {
      this._startLayerDeactivationFade(activation);
    }
  }

  private _advanceLayerActivationState(
    activation: LayerActivationState,
    deltaSec: number,
  ): void {
    if (activation.currentWeight === activation.targetWeight) {
      return;
    }

    const step =
      LAYER_ACTIVATION_BLEND_SEC <= 0
        ? 1
        : deltaSec / LAYER_ACTIVATION_BLEND_SEC;
    const nextWeight = moveTowards(
      activation.currentWeight,
      activation.targetWeight,
      step,
    );
    activation.currentWeight =
      Math.abs(nextWeight - activation.targetWeight) <= LAYER_ACTIVATION_EPSILON
        ? activation.targetWeight
        : nextWeight;
  }

  private _finalizeLayerActivationState(
    layer: ProceduralAnimationLayer,
    activation: LayerActivationState,
  ): void {
    if (
      activation.desiredEnabled ||
      activation.currentWeight > LAYER_ACTIVATION_EPSILON ||
      !activation.physicallyEnabled
    ) {
      return;
    }

    layer.setEnabled(false);
    activation.physicallyEnabled = false;
    activation.currentWeight = 0;
    activation.targetWeight = 0;
  }

  private _resetLayerActivationState(layer: ProceduralAnimationLayer): void {
    this._layerActivationStates.set(
      layer.id,
      createLayerActivationState(layer.getSnapshot().enabled),
    );
  }

  private _requestLayerDeactivation(
    layer: ProceduralAnimationLayer,
    activation: LayerActivationState,
  ): void {
    if (!activation.physicallyEnabled || activation.currentWeight <= 0) {
      this._startLayerDeactivationFade(activation);
      return;
    }

    const transition = layer.getTransitionState?.();
    const maxWaitSec = sanitizeLayerNaturalDeactivationWaitSec(
      transition?.maxWaitSec,
    );

    if (!transition || transition.canDeactivateNow || maxWaitSec <= 0) {
      this._startLayerDeactivationFade(activation);
      return;
    }

    activation.naturalDeactivatePending = true;
    activation.naturalDeactivateElapsedSec = 0;
    activation.naturalDeactivateMaxWaitSec = maxWaitSec;
    activation.targetWeight = activation.currentWeight;
  }

  private _shouldStartLayerDeactivationFade(
    layer: ProceduralAnimationLayer,
    activation: LayerActivationState,
  ): boolean {
    if (!activation.naturalDeactivatePending) return false;
    if (!activation.physicallyEnabled) return true;
    if (activation.currentWeight <= LAYER_ACTIVATION_EPSILON) return true;

    const transition = layer.getTransitionState?.();
    if (!transition) return true;
    if (transition.canDeactivateNow) return true;
    return (
      activation.naturalDeactivateElapsedSec >=
      activation.naturalDeactivateMaxWaitSec
    );
  }

  private _startLayerDeactivationFade(activation: LayerActivationState): void {
    activation.naturalDeactivatePending = false;
    activation.naturalDeactivateElapsedSec = 0;
    activation.naturalDeactivateMaxWaitSec = 0;
    activation.targetWeight = 0;
  }

  private _getLayerActivationState(
    layer: ProceduralAnimationLayer,
  ): LayerActivationState {
    const existing = this._layerActivationStates.get(layer.id);
    if (existing) return existing;

    const activation = createLayerActivationState(layer.getSnapshot().enabled);
    this._layerActivationStates.set(layer.id, activation);
    return activation;
  }
}

function createLayerActivationState(enabled: boolean): LayerActivationState {
  const weight = enabled ? 1 : 0;
  return {
    currentWeight: weight,
    targetWeight: weight,
    desiredEnabled: enabled,
    physicallyEnabled: enabled,
    naturalDeactivatePending: false,
    naturalDeactivateElapsedSec: 0,
    naturalDeactivateMaxWaitSec: 0,
  };
}

function sanitizeLayerNaturalDeactivationWaitSec(
  value: ProceduralAnimationTransitionState["maxWaitSec"] | undefined,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(LAYER_NATURAL_DEACTIVATION_MAX_WAIT_SEC, Math.max(0, value));
}

function canStatePolicyActivateLayer(layer: ProceduralAnimationLayer): boolean {
  const snapshot = layer.getSnapshot();
  if (snapshot.id === "emotionPosture") {
    return snapshot.resolvedBones.length > 0 && snapshot.weight > 0;
  }
  const intensity =
    "intensity" in snapshot.params ? snapshot.params.intensity : 0;
  return (
    snapshot.resolvedBones.length > 0 && snapshot.weight > 0 && intensity > 0
  );
}

function moveTowards(
  current: number,
  target: number,
  maxDelta: number,
): number {
  if (!Number.isFinite(maxDelta) || maxDelta <= 0) return current;
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}
