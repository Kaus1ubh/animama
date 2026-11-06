import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

import {
  DEFAULT_CURSOR_LOOK_AT_PROCEDURAL_ANIMATION_PARAMS,
  type CursorLookAtInputProvider,
  type CursorLookAtProceduralAnimationParams,
  type ProceduralAnimationLayer,
  type ProceduralAnimationLayerSnapshot,
  type ProceduralAnimationRuntimeContext,
  type ProceduralAnimationTransitionState,
} from "./types";
import {
  randomRange,
  sanitizeActivationWeight,
  sanitizeNonNegativeNumber,
} from "./layerParams";

const DEFAULT_LAYER_WEIGHT = 1;
const TARGET_DISTANCE = 2;
const TARGET_PLANE_HALF_SIZE = 2;
const TARGET_SMOOTH_SPEED = 5;
const BLEND_TIME_SEC = 0.75;
const DEACTIVATION_EPSILON = 0.025;
const TARGET_NEUTRAL_EPSILON = 0.025;
const DEACTIVATION_MAX_WAIT_SEC = 1.2;
const DEFAULT_FACE_FORWARD_Z = 1;
const DEG_TO_RAD = Math.PI / 180;
const EPSILON = 0.0001;
const HEAD_FOLLOW_YAW_DEG = 7;
const HEAD_FOLLOW_PITCH_DEG = 5;
const HEAD_FOLLOW_ROLL_DEG = 1.5;
const NECK_FOLLOW_YAW_DEG = 4;
const NECK_FOLLOW_PITCH_DEG = 3;
const NECK_FOLLOW_ROLL_DEG = 1;
const TORSO_FOLLOW_YAW_DEG = 2;
const TORSO_FOLLOW_PITCH_DEG = 1.2;
const TORSO_FOLLOW_ROLL_DEG = 0.8;

const BODY_FOLLOW_BONE_NAMES = [
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
] as const satisfies readonly VRMHumanBoneName[];

type CursorLookAtSchedulerState = "tracking" | "pause";
type BodyFollowBoneName = (typeof BODY_FOLLOW_BONE_NAMES)[number];

export type CursorLookAtProceduralAnimationLayerOptions = {
  camera?: THREE.Object3D | null;
  inputProvider?: CursorLookAtInputProvider | null;
  viewportElement?: HTMLElement | null;
};

export class CursorLookAtProceduralAnimationLayer implements ProceduralAnimationLayer<"cursorLookAt"> {
  readonly id = "cursorLookAt";

  private _vrm: VRM | null;
  private _camera: THREE.Object3D | null;
  private _inputProvider: CursorLookAtInputProvider | null;
  private _viewportElement: HTMLElement | null;
  private _params: CursorLookAtProceduralAnimationParams = {
    ...DEFAULT_CURSOR_LOOK_AT_PROCEDURAL_ANIMATION_PARAMS,
  };
  private _weight: number = DEFAULT_LAYER_WEIGHT;
  private _bones = new Map<BodyFollowBoneName, THREE.Object3D>();
  private _lastOffsets = new Map<BodyFollowBoneName, THREE.Quaternion>();
  private _offsetScratchByBone = new Map<
    BodyFollowBoneName,
    THREE.Quaternion
  >();
  private _target: THREE.Object3D | null = null;
  private _state: CursorLookAtSchedulerState = "pause";
  private _stateRemainingSec: number = 0;
  private _elapsedSec: number = 0;
  private _pointerNdc = new THREE.Vector2(0, 0);
  private _pointerOffset = new THREE.Vector2(0, 0);
  private _pointerClient = new THREE.Vector2(0, 0);
  private _neutralNdc = new THREE.Vector2(0, 0);
  private _lookAtLocalOrigin = new THREE.Vector3(0, 1.2, 0);
  private _desiredLocalPosition = new THREE.Vector3(
    0,
    1.2,
    DEFAULT_FACE_FORWARD_Z * TARGET_DISTANCE,
  );
  private _neutralLocalPosition = new THREE.Vector3(
    0,
    1.2,
    DEFAULT_FACE_FORWARD_Z * TARGET_DISTANCE,
  );
  private _neutralWorldDirection = new THREE.Vector3(0, 0, 1);
  private _neutralWorldPosition = new THREE.Vector3();
  private _scratchWorldPosition = new THREE.Vector3();
  private _scratchLocalOrigin = new THREE.Vector3();
  private _scratchLookAtWorldQuaternion = new THREE.Quaternion();
  private _scratchFaceFrontQuaternion = new THREE.Quaternion();
  private _scratchProjectedNeutral = new THREE.Vector3();
  private _scratchEuler = new THREE.Euler(0, 0, 0, "XYZ");
  private _scratchOffset = new THREE.Quaternion();
  private _scratchInverseOffset = new THREE.Quaternion();
  private _visibleWeight: number = 0;
  private _hasTargetPosition: boolean = false;
  private _hasPointerListener: boolean = false;
  private _hasPointerPosition: boolean = false;
  /**
   * The viewport element's client rect, read once and dropped when the element
   * resizes or the window resizes or scrolls. Reading it every frame forced a
   * style recalculation each frame.
   */
  private _viewportRect: DOMRect | null = null;
  private _viewportObserver: ResizeObserver | null = null;

  private _invalidateViewportRect = () => {
    this._viewportRect = null;
  };

  private _handlePointerMove = (event: PointerEvent) => {
    this._pointerClient.set(event.clientX, event.clientY);
    this._hasPointerPosition = true;
    this._updatePointerNdcFromClient();
  };

  constructor(
    vrm: VRM,
    options: CursorLookAtProceduralAnimationLayerOptions = {},
  ) {
    this._vrm = vrm;
    this._camera = options.camera ?? null;
    this._inputProvider = options.inputProvider ?? null;
    this._viewportElement = options.viewportElement ?? null;
    this._cacheBones();
    this._scheduleInitialPauseWindow();
    this._attachPointerListener();
  }

  clearOffsets(): void {
    if (!this._lastOffsets.size) return;

    this._lastOffsets.forEach((offset, boneName) => {
      const bone = this._bones.get(boneName);
      if (!bone) return;

      this._scratchInverseOffset.copy(offset).invert();
      bone.quaternion.multiply(this._scratchInverseOffset);
    });
    this._lastOffsets.clear();
  }

  update(deltaSec: number, context: ProceduralAnimationRuntimeContext): void {
    this.clearOffsets();

    if (!this._vrm || !this._params.enabled) return;

    this._elapsedSec += deltaSec;
    if (context.avatarState === "idle") {
      this._advanceScheduler(deltaSec);
    }

    const activationWeight = sanitizeActivationWeight(
      context.layerActivationWeight,
    );
    const deactivationRequested = context.layerDeactivationRequested === true;
    const shouldTrack =
      context.avatarState === "idle" &&
      !deactivationRequested &&
      this._state === "tracking" &&
      this._params.intensity > 0 &&
      this._params.eyeLookAtStrength > 0 &&
      this._weight > 0 &&
      activationWeight > 0;
    this._visibleWeight = damp(
      this._visibleWeight,
      shouldTrack ? 1 : 0,
      deltaSec,
      BLEND_TIME_SEC,
    );

    const effectiveStrength = THREE.MathUtils.clamp(
      this._params.intensity *
        this._params.eyeLookAtStrength *
        this._weight *
        activationWeight *
        this._visibleWeight,
      0,
      1,
    );

    if (!this._updateLookAtTarget(effectiveStrength, deltaSec)) {
      return;
    }

    if (
      context.avatarState !== "idle" &&
      effectiveStrength <= DEACTIVATION_EPSILON &&
      this._targetIsNeutral()
    ) {
      this._clearLookAtTarget();
    }
  }

  getSnapshot(): ProceduralAnimationLayerSnapshot<"cursorLookAt"> {
    const hasLookAt = Boolean(this._vrm?.lookAt);
    return {
      id: this.id,
      enabled: this._params.enabled,
      weight: this._weight,
      params: { ...this._params },
      resolvedBones: [
        ...(hasLookAt ? ["vrm.lookAt"] : []),
        ...BODY_FOLLOW_BONE_NAMES.filter((boneName) =>
          this._bones.has(boneName),
        ),
      ],
      missingBones: [
        ...(hasLookAt ? [] : ["vrm.lookAt"]),
        ...BODY_FOLLOW_BONE_NAMES.filter(
          (boneName) => !this._bones.has(boneName),
        ),
      ],
    };
  }

  getTransitionState(): ProceduralAnimationTransitionState {
    return {
      canDeactivateNow:
        !this._params.enabled ||
        this._params.intensity <= 0 ||
        (this._visibleWeight <= DEACTIVATION_EPSILON &&
          this._targetIsNeutral()),
      maxWaitSec: DEACTIVATION_MAX_WAIT_SEC,
    };
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this._params.enabled;
    this._params.enabled = enabled;

    if (!enabled) {
      this._visibleWeight = 0;
      this.clearOffsets();
      this._clearLookAtTarget();
      this._detachPointerListener();
      return;
    }

    if (!wasEnabled) {
      this._scheduleInitialPauseWindow();
      this._attachPointerListener();
    }
  }

  setWeight(weight: number): void {
    if (!Number.isFinite(weight)) return;

    this._weight = THREE.MathUtils.clamp(weight, 0, 1);
    if (this._weight <= 0) {
      this._visibleWeight = 0;
      this.clearOffsets();
      this._clearLookAtTarget();
    }
  }

  setParams(params: Partial<CursorLookAtProceduralAnimationParams>): void {
    const wasEnabled = this._params.enabled;
    const wasInactive = this._params.intensity <= 0;

    if (typeof params.enabled === "boolean") {
      this._params.enabled = params.enabled;
    }
    this._params.intensity = sanitizeNonNegativeNumber(
      params.intensity,
      this._params.intensity,
    );
    this._params.durationMinSec = sanitizeNonNegativeNumber(
      params.durationMinSec,
      this._params.durationMinSec,
    );
    this._params.durationMaxSec = sanitizeNonNegativeNumber(
      params.durationMaxSec,
      this._params.durationMaxSec,
    );
    this._params.pauseMinSec = sanitizeNonNegativeNumber(
      params.pauseMinSec,
      this._params.pauseMinSec,
    );
    this._params.pauseMaxSec = sanitizeNonNegativeNumber(
      params.pauseMaxSec,
      this._params.pauseMaxSec,
    );
    this._params.eyeLookAtStrength = sanitizeUnitInterval(
      params.eyeLookAtStrength,
      this._params.eyeLookAtStrength,
    );
    this._params.headFollowStrength = sanitizeUnitInterval(
      params.headFollowStrength,
      this._params.headFollowStrength,
    );
    this._params.neckFollowStrength = sanitizeUnitInterval(
      params.neckFollowStrength,
      this._params.neckFollowStrength,
    );
    this._params.torsoFollowStrength = sanitizeUnitInterval(
      params.torsoFollowStrength,
      this._params.torsoFollowStrength,
    );
    this._params.driftAmount = sanitizeNonNegativeNumber(
      params.driftAmount,
      this._params.driftAmount,
    );
    this._params.driftSpeed = sanitizeNonNegativeNumber(
      params.driftSpeed,
      this._params.driftSpeed,
    );

    if (!this._params.enabled || this._params.intensity <= 0) {
      this._visibleWeight = 0;
      this.clearOffsets();
      this._clearLookAtTarget();
      if (!this._params.enabled) {
        this._detachPointerListener();
      }
      return;
    }

    if (!wasEnabled || wasInactive) {
      this._scheduleInitialPauseWindow();
      this._attachPointerListener();
    }
  }

  reset(): void {
    this.clearOffsets();
    this._clearLookAtTarget();
    this._params = {
      ...DEFAULT_CURSOR_LOOK_AT_PROCEDURAL_ANIMATION_PARAMS,
    };
    this._weight = DEFAULT_LAYER_WEIGHT;
    this._visibleWeight = 0;
    this._elapsedSec = 0;
    this._pointerNdc.set(0, 0);
    this._hasPointerPosition = false;
    this._scheduleInitialPauseWindow();
    this._attachPointerListener();
  }

  dispose(): void {
    this.clearOffsets();
    this._clearLookAtTarget();
    this._detachPointerListener();
    this._stopObservingViewport();
    this._vrm = null;
    this._camera = null;
    this._inputProvider = null;
    this._viewportElement = null;
    this._bones.clear();
  }

  private _advanceScheduler(deltaSec: number): void {
    this._stateRemainingSec -= Math.max(0, deltaSec);
    if (this._stateRemainingSec > 0) return;

    if (this._state === "tracking") {
      this._scheduleNextPauseWindow();
      return;
    }
    this._scheduleNextTrackingWindow();
  }

  private _scheduleInitialPauseWindow(): void {
    this._scheduleNextPauseWindow();
  }

  private _scheduleNextTrackingWindow(): void {
    const [durationMin, durationMax] = sortedPair(
      this._params.durationMinSec,
      this._params.durationMaxSec,
    );
    this._state = "tracking";
    this._stateRemainingSec = randomRange(durationMin, durationMax);
  }

  private _scheduleNextPauseWindow(): void {
    const [pauseMin, pauseMax] = sortedPair(
      this._params.pauseMinSec,
      this._params.pauseMaxSec,
    );
    this._state = "pause";
    this._stateRemainingSec = randomRange(pauseMin, pauseMax);
  }

  private _updateLookAtTarget(strength: number, deltaSec: number): boolean {
    const target = this._ensureLookAtTarget();
    if (!target || !this._vrm) return false;

    this._updateLookAtOrigin();

    const driftPhase = this._elapsedSec * this._params.driftSpeed * Math.PI * 2;
    const driftX = Math.sin(driftPhase) * this._params.driftAmount;
    const driftY =
      Math.sin(driftPhase * 0.73 + Math.PI * 0.35) *
      this._params.driftAmount *
      0.65;
    const pointerOffset = this._getPointerOffsetFromNeutral();
    const horizontalCursorAxisSign = this._getHorizontalCursorAxisSign();
    const targetX =
      (pointerOffset.x * TARGET_PLANE_HALF_SIZE + driftX) *
      strength *
      horizontalCursorAxisSign;
    const targetY =
      (pointerOffset.y * TARGET_PLANE_HALF_SIZE + driftY) * strength;

    this._desiredLocalPosition.set(
      this._neutralLocalPosition.x + targetX,
      this._neutralLocalPosition.y + targetY,
      this._neutralLocalPosition.z,
    );

    if (!this._hasTargetPosition) {
      target.position.copy(this._neutralLocalPosition);
      this._hasTargetPosition = true;
    }

    target.position.lerp(
      this._desiredLocalPosition,
      THREE.MathUtils.clamp(TARGET_SMOOTH_SPEED * Math.max(0, deltaSec), 0, 1),
    );
    this._applyBodyFollow(target);
    return true;
  }

  private _cacheBones(): void {
    this._bones.clear();
    if (!this._vrm) return;

    for (const boneName of BODY_FOLLOW_BONE_NAMES) {
      const bone = this._vrm.humanoid.getNormalizedBoneNode(boneName);
      if (bone) {
        this._bones.set(boneName, bone);
      }
    }
  }

  private _applyBodyFollow(target: THREE.Object3D): void {
    const headFollowStrength = this._params.headFollowStrength;
    const neckFollowStrength = this._params.neckFollowStrength;
    const torsoFollowStrength = this._params.torsoFollowStrength;
    if (
      headFollowStrength <= 0 &&
      neckFollowStrength <= 0 &&
      torsoFollowStrength <= 0
    ) {
      return;
    }

    const bodyX = THREE.MathUtils.clamp(
      (target.position.x - this._neutralLocalPosition.x) /
        TARGET_PLANE_HALF_SIZE /
        this._getHorizontalCursorAxisSign(),
      -1,
      1,
    );
    const bodyY = THREE.MathUtils.clamp(
      ((target.position.y - this._neutralLocalPosition.y) /
        TARGET_PLANE_HALF_SIZE) *
        this._getBodyVerticalAxisSign(),
      -1,
      1,
    );
    if (Math.abs(bodyX) <= EPSILON && Math.abs(bodyY) <= EPSILON) {
      return;
    }

    const headYaw = bodyX * HEAD_FOLLOW_YAW_DEG * headFollowStrength;
    const headPitch = bodyY * HEAD_FOLLOW_PITCH_DEG * headFollowStrength;
    const headRoll = -bodyX * HEAD_FOLLOW_ROLL_DEG * headFollowStrength;
    const neckYaw = bodyX * NECK_FOLLOW_YAW_DEG * neckFollowStrength;
    const neckPitch = bodyY * NECK_FOLLOW_PITCH_DEG * neckFollowStrength;
    const neckRoll = -bodyX * NECK_FOLLOW_ROLL_DEG * neckFollowStrength;
    const torsoYaw = bodyX * TORSO_FOLLOW_YAW_DEG * torsoFollowStrength;
    const torsoPitch = bodyY * TORSO_FOLLOW_PITCH_DEG * torsoFollowStrength;
    const torsoRoll = -bodyX * TORSO_FOLLOW_ROLL_DEG * torsoFollowStrength;

    this._applyOffset(
      "spine",
      torsoPitch * 0.2,
      torsoYaw * 0.2,
      torsoRoll * 0.2,
    );
    this._applyOffset(
      "chest",
      torsoPitch * 0.35,
      torsoYaw * 0.35,
      torsoRoll * 0.35,
    );
    this._applyOffset(
      "upperChest",
      torsoPitch * 0.45,
      torsoYaw * 0.45,
      torsoRoll * 0.45,
    );
    this._applyOffset("neck", neckPitch, neckYaw, neckRoll);
    this._applyOffset("head", headPitch, headYaw, headRoll);
  }

  private _applyOffset(
    boneName: BodyFollowBoneName,
    pitchDeg: number,
    yawDeg: number,
    rollDeg: number,
  ): void {
    if (
      Math.abs(pitchDeg) <= EPSILON &&
      Math.abs(yawDeg) <= EPSILON &&
      Math.abs(rollDeg) <= EPSILON
    ) {
      return;
    }

    const bone = this._bones.get(boneName);
    if (!bone) return;

    this._scratchEuler.set(
      pitchDeg * DEG_TO_RAD,
      yawDeg * DEG_TO_RAD,
      rollDeg * DEG_TO_RAD,
      "XYZ",
    );
    this._scratchOffset.setFromEuler(this._scratchEuler);

    const offset = this._getOffsetScratch(boneName);
    offset.copy(this._scratchOffset);
    bone.quaternion.multiply(offset);
    this._lastOffsets.set(boneName, offset);
  }

  private _getOffsetScratch(boneName: BodyFollowBoneName): THREE.Quaternion {
    const existing = this._offsetScratchByBone.get(boneName);
    if (existing) return existing;

    const offset = new THREE.Quaternion();
    this._offsetScratchByBone.set(boneName, offset);
    return offset;
  }

  private _updateLookAtOrigin(): void {
    if (!this._vrm) return;

    this._vrm.scene.updateMatrixWorld(true);
    const lookAt = this._vrm.lookAt;
    if (lookAt) {
      lookAt.getLookAtWorldPosition(this._scratchWorldPosition);
      this._scratchLocalOrigin.copy(this._scratchWorldPosition);
      this._vrm.scene.worldToLocal(this._scratchLocalOrigin);
      this._lookAtLocalOrigin.copy(this._scratchLocalOrigin);
      this._updateNeutralLocalPositionFromLookAt(lookAt);
      this._updateNeutralNdcFromWorldPosition(this._scratchWorldPosition);
    } else {
      let hasLookAtOrigin = false;
      const head = this._vrm.humanoid.getNormalizedBoneNode("head");
      if (head) {
        head.getWorldPosition(this._scratchWorldPosition);
        this._scratchLocalOrigin.copy(this._scratchWorldPosition);
        this._vrm.scene.worldToLocal(this._scratchLocalOrigin);
        this._lookAtLocalOrigin.copy(this._scratchLocalOrigin);
        hasLookAtOrigin = true;
      }
      this._neutralLocalPosition.set(
        this._lookAtLocalOrigin.x,
        this._lookAtLocalOrigin.y,
        this._lookAtLocalOrigin.z + this._getFaceForwardZ() * TARGET_DISTANCE,
      );
      if (hasLookAtOrigin) {
        this._updateNeutralNdcFromWorldPosition(this._scratchWorldPosition);
      }
    }
  }

  private _updateNeutralLocalPositionFromLookAt(
    lookAt: NonNullable<VRM["lookAt"]>,
  ): void {
    if (!this._vrm) return;

    // Match VRMLookAt.getLookAtWorldDirection() at yaw/pitch zero so neutral
    // gaze follows the model's current head pose and face-front convention.
    this._neutralWorldDirection
      .set(0, 0, 1)
      .applyQuaternion(
        lookAt.getLookAtWorldQuaternion(this._scratchLookAtWorldQuaternion),
      )
      .applyQuaternion(
        lookAt.getFaceFrontQuaternion(this._scratchFaceFrontQuaternion),
      )
      .normalize();
    this._neutralWorldPosition
      .copy(this._scratchWorldPosition)
      .addScaledVector(this._neutralWorldDirection, TARGET_DISTANCE);
    this._scratchLocalOrigin.copy(this._neutralWorldPosition);
    this._vrm.scene.worldToLocal(this._scratchLocalOrigin);
    this._neutralLocalPosition.set(
      this._scratchLocalOrigin.x,
      this._scratchLocalOrigin.y,
      this._scratchLocalOrigin.z,
    );
  }

  private _getFaceForwardZ(): number {
    const faceFrontZ = this._vrm?.lookAt?.faceFront.z;
    if (typeof faceFrontZ !== "number" || Math.abs(faceFrontZ) < 0.001) {
      return DEFAULT_FACE_FORWARD_Z;
    }
    return faceFrontZ < 0 ? -1 : 1;
  }

  private _getHorizontalCursorAxisSign(): number {
    // VRM0 uses faceFront = -Z, which mirrors local horizontal look-at offsets.
    // Vertical screen direction stays consistent across VRM0 and VRM1.
    return this._getFaceForwardZ();
  }

  private _getBodyVerticalAxisSign(): number {
    // Bone pitch uses the opposite visual vertical direction for VRM1 face-front
    // models, while VRM0 matches the screen-space vertical cursor axis.
    return -this._getFaceForwardZ();
  }

  private _getPointerOffsetFromNeutral(): THREE.Vector2 {
    this._readExternalPointerInput();

    if (!this._hasPointerPosition) {
      this._pointerNdc.set(this._neutralNdc.x, this._neutralNdc.y);
    } else {
      this._updatePointerNdcFromClient();
    }

    return this._pointerOffset
      .copy(this._pointerNdc)
      .sub(this._neutralNdc)
      .clampScalar(-1, 1);
  }

  private _readExternalPointerInput(): void {
    const input = this._inputProvider?.();
    if (!input) return;
    if (!Number.isFinite(input.clientX) || !Number.isFinite(input.clientY)) {
      return;
    }

    this._pointerClient.set(input.clientX, input.clientY);
    this._hasPointerPosition = true;
  }

  private _updatePointerNdcFromClient(): void {
    const rect = this._getViewportRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    this._pointerNdc.set(
      THREE.MathUtils.clamp(
        ((this._pointerClient.x - rect.left) / rect.width) * 2 - 1,
        -1,
        1,
      ),
      THREE.MathUtils.clamp(
        -(((this._pointerClient.y - rect.top) / rect.height) * 2 - 1),
        -1,
        1,
      ),
    );
  }

  private _updateNeutralNdcFromWorldPosition(
    worldPosition: THREE.Vector3,
  ): void {
    const camera = this._camera instanceof THREE.Camera ? this._camera : null;
    if (!camera) {
      this._neutralNdc.set(0, 0);
      return;
    }

    camera.updateMatrixWorld(true);
    this._scratchProjectedNeutral.copy(worldPosition).project(camera);
    if (
      !Number.isFinite(this._scratchProjectedNeutral.x) ||
      !Number.isFinite(this._scratchProjectedNeutral.y)
    ) {
      this._neutralNdc.set(0, 0);
      return;
    }

    this._neutralNdc.set(
      THREE.MathUtils.clamp(this._scratchProjectedNeutral.x, -1, 1),
      THREE.MathUtils.clamp(this._scratchProjectedNeutral.y, -1, 1),
    );
  }

  private _getViewportRect(): DOMRect | null {
    const element = this._viewportElement;
    if (element) {
      if (this._viewportRect) return this._viewportRect;
      const rect = element.getBoundingClientRect();
      // Without ResizeObserver nothing would drop a stale rect, so read it fresh.
      if (this._observeViewport(element)) this._viewportRect = rect;
      return rect;
    }

    if (typeof window === "undefined") return null;
    return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  }

  private _ensureLookAtTarget(): THREE.Object3D | null {
    if (!this._vrm?.lookAt) return null;
    if (!this._target) {
      const target = new THREE.Object3D();
      target.name = "AnimaCursorLookAtTarget";
      this._vrm.scene.add(target);
      this._target = target;
      this._hasTargetPosition = false;
    }

    if (this._vrm.lookAt.target !== this._target) {
      this._vrm.lookAt.target = this._target;
    }
    return this._target;
  }

  private _clearLookAtTarget(): void {
    const lookAt = this._vrm?.lookAt;
    if (lookAt?.target === this._target) {
      lookAt.target = null;
      lookAt.reset();
    }
    this._target?.removeFromParent();
    this._target = null;
    this._hasTargetPosition = false;
  }

  private _targetIsNeutral(): boolean {
    if (!this._target || !this._hasTargetPosition) return true;
    return (
      this._target.position.distanceTo(this._neutralLocalPosition) <=
      TARGET_NEUTRAL_EPSILON
    );
  }

  private _attachPointerListener(): void {
    if (this._inputProvider) return;
    if (this._hasPointerListener || typeof window === "undefined") return;
    window.addEventListener("pointermove", this._handlePointerMove, {
      passive: true,
    });
    this._hasPointerListener = true;
  }

  private _detachPointerListener(): void {
    if (!this._hasPointerListener || typeof window === "undefined") return;
    window.removeEventListener("pointermove", this._handlePointerMove);
    this._hasPointerListener = false;
  }

  /** Watch the viewport for changes to its rect. Returns whether it can. */
  private _observeViewport(element: HTMLElement): boolean {
    if (this._viewportObserver) return true;
    if (
      typeof ResizeObserver === "undefined" ||
      typeof window === "undefined"
    ) {
      return false;
    }
    this._viewportObserver = new ResizeObserver(this._invalidateViewportRect);
    this._viewportObserver.observe(element);
    window.addEventListener("resize", this._invalidateViewportRect);
    window.addEventListener("scroll", this._invalidateViewportRect, {
      capture: true,
      passive: true,
    });
    return true;
  }

  private _stopObservingViewport(): void {
    if (!this._viewportObserver) return;
    this._viewportObserver.disconnect();
    this._viewportObserver = null;
    this._viewportRect = null;
    window.removeEventListener("resize", this._invalidateViewportRect);
    window.removeEventListener("scroll", this._invalidateViewportRect, {
      capture: true,
    });
  }
}

function sortedPair(left: number, right: number): [number, number] {
  return left <= right ? [left, right] : [right, left];
}

function sanitizeUnitInterval(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return THREE.MathUtils.clamp(value, 0, 1);
}

function damp(
  current: number,
  target: number,
  deltaSec: number,
  smoothTimeSec: number,
): number {
  if (smoothTimeSec <= 0) return target;
  return THREE.MathUtils.lerp(
    current,
    target,
    dampStep(deltaSec, smoothTimeSec),
  );
}

function dampStep(deltaSec: number, smoothTimeSec: number): number {
  if (smoothTimeSec <= 0) return 1;
  return 1 - Math.exp(-Math.max(0, deltaSec) / smoothTimeSec);
}
