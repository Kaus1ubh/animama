import * as THREE from "three";

import type { Avatar } from "../Avatar";
import { addAvatarIssue, type AvatarIssue } from "../diagnostics/issues";
import type {
  AvatarFaceBoxCoordinate,
  AvatarFaceEyeLandmarkSnapshot,
  AvatarFaceLandmarkBounds,
  AvatarFaceLandmarksSnapshot,
  AvatarFaceLandmarkVector,
  AvatarFaceTextureRect,
} from "./landmark-types";
import { resolveAvatarFacePartEntries } from "./faceParts";
import {
  collectPrimitiveData,
  readVertexPosition,
  resolvePrimitiveVertexRange,
  UnionFind,
  type RuntimePrimitiveBindingEntry,
} from "./avatarPrimitiveUtils";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";
import { createLogger } from "@/lib/logger";

const logger = createLogger("AvatarFaceLandmarks");
const EPSILON = 1e-6;
const HAIR_SEARCH_X_PADDING_RATIO = 0.15;
const HAIR_SEARCH_Y_PADDING_RATIO = 0.35;
const HAIR_CLEARANCE_MARGIN_MIN = 0.003;
const HAIR_CLEARANCE_MARGIN_DEPTH_RATIO = 0.04;
const HAIR_COARSE_SAMPLE_LIMIT = 256;
const MAX_RETAINED_HAIR_BINDINGS = 12;

type FrontAxisSign = -1 | 1;

type InternalEyeLandmark = {
  bindingKey: string;
  materialName: string | null;
  vertexCount: number;
  bounds: THREE.Box3;
  center: THREE.Vector3;
  projectedFront: THREE.Vector3;
  normalizedBoxCoord: AvatarFaceBoxCoordinate;
  projectedBoxCoord: AvatarFaceBoxCoordinate;
  textureRect: AvatarFaceTextureRect | null;
};

type PrimitiveIsland = {
  bindingKey: string;
  materialName: string | null;
  vertexCount: number;
  bounds: THREE.Box3;
  center: THREE.Vector3;
  textureRect: AvatarFaceTextureRect | null;
};

type HairFrontSearchWindow = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type HairFrontSample = {
  maxSignedFront: number;
  pointCount: number;
};

function toVectorSnapshot(value: THREE.Vector3): AvatarFaceLandmarkVector {
  return {
    x: value.x,
    y: value.y,
    z: value.z,
  };
}

function toBoundsSnapshot(box: THREE.Box3): AvatarFaceLandmarkBounds {
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return {
    min: toVectorSnapshot(box.min),
    max: toVectorSnapshot(box.max),
    size: toVectorSnapshot(size),
    center: toVectorSnapshot(center),
  };
}

function clampBoxCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function normalizePointWithinBounds(
  point: THREE.Vector3,
  bounds: THREE.Box3,
): AvatarFaceBoxCoordinate {
  const size = new THREE.Vector3();
  bounds.getSize(size);
  return {
    u:
      Math.abs(size.x) <= EPSILON
        ? 0.5
        : clampBoxCoordinate((point.x - bounds.min.x) / size.x),
    v:
      Math.abs(size.y) <= EPSILON
        ? 0.5
        : clampBoxCoordinate((point.y - bounds.min.y) / size.y),
    w:
      Math.abs(size.z) <= EPSILON
        ? 0.5
        : clampBoxCoordinate((point.z - bounds.min.z) / size.z),
  };
}

function computeCentroid(points: readonly THREE.Vector3[]): THREE.Vector3 {
  const centroid = new THREE.Vector3();
  if (points.length === 0) return centroid;
  points.forEach((point) => {
    centroid.add(point);
  });
  return centroid.multiplyScalar(1 / points.length);
}

function createBoxFromPoints(
  points: readonly THREE.Vector3[],
): THREE.Box3 | null {
  if (points.length === 0) return null;
  const box = new THREE.Box3();
  let hasPoint = false;
  points.forEach((point) => {
    if (!hasPoint) {
      box.min.copy(point);
      box.max.copy(point);
      hasPoint = true;
    } else {
      box.expandByPoint(point);
    }
  });
  return hasPoint ? box : null;
}

function cloneWorldPoint(
  anchorObject: THREE.Object3D | null,
  localPoint: THREE.Vector3,
): AvatarFaceLandmarkVector | null {
  if (!anchorObject) return null;
  anchorObject.updateWorldMatrix(true, false);
  const point = localPoint.clone();
  anchorObject.localToWorld(point);
  return toVectorSnapshot(point);
}

function createEmptySnapshot(
  warnings: string[] = [],
  issues: AvatarIssue[] = [],
): AvatarFaceLandmarksSnapshot {
  return {
    status: "unavailable",
    warnings,
    issues,
    anchorName: null,
    anchorType: null,
    faceBindingKey: null,
    faceMaterialName: null,
    faceBoundsLocal: null,
    frontZLocal: null,
    boxHoverClearanceLocal: null,
    boxHoverFrontZLocal: null,
    eyes: {
      left: null,
      right: null,
    },
  };
}

export class AvatarFaceLandmarks {
  private readonly _avatar: Avatar;
  private _anchorObject: THREE.Object3D | null = null;
  private _faceBounds: THREE.Box3 | null = null;
  private _faceBindingKey: string | null = null;
  private _faceMaterialName: string | null = null;
  private _frontZLocal: number | null = null;
  private _boxHoverClearanceLocal: number | null = null;
  private _boxHoverFrontZLocal: number | null = null;
  private _eyes: {
    left: InternalEyeLandmark | null;
    right: InternalEyeLandmark | null;
  } = {
    left: null,
    right: null,
  };
  private _warnings: string[] = [];
  private _issues: AvatarIssue[] = [];
  private _snapshot: AvatarFaceLandmarksSnapshot = createEmptySnapshot();
  private _isDisposed = false;

  constructor(avatar: Avatar) {
    this._avatar = avatar;
    this._build();
  }

  getAnchorObject(): THREE.Object3D | null {
    return this._anchorObject;
  }

  getFaceBoundsBox(): THREE.Box3 | null {
    return this._faceBounds?.clone() ?? null;
  }

  getSnapshot(): AvatarFaceLandmarksSnapshot {
    if (!this._faceBounds) {
      return this._snapshot;
    }

    return {
      status: "ready",
      warnings: [...this._warnings],
      issues: [...this._issues],
      anchorName: this._anchorObject?.name?.trim() || null,
      anchorType: this._anchorObject?.type ?? null,
      faceBindingKey: this._faceBindingKey,
      faceMaterialName: this._faceMaterialName,
      faceBoundsLocal: toBoundsSnapshot(this._faceBounds),
      frontZLocal: this._frontZLocal,
      boxHoverClearanceLocal: this._boxHoverClearanceLocal ?? 0,
      boxHoverFrontZLocal: this._boxHoverFrontZLocal ?? this._frontZLocal,
      eyes: {
        left: this._serializeEyeLandmark(this._eyes.left),
        right: this._serializeEyeLandmark(this._eyes.right),
      },
    };
  }

  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    this._anchorObject = null;
    this._faceBounds = null;
    this._faceBindingKey = null;
    this._faceMaterialName = null;
    this._frontZLocal = null;
    this._boxHoverClearanceLocal = null;
    this._boxHoverFrontZLocal = null;
    this._eyes = { left: null, right: null };
    this._warnings = [];
    this._issues = [];
    this._snapshot = createEmptySnapshot();
  }

  /** Record a finding as dev-panel text and as a stable code. */
  private _warn(issue: AvatarIssue, message: string): void {
    this._warnings.push(message);
    addAvatarIssue(this._issues, issue);
  }

  private _serializeEyeLandmark(
    eye: InternalEyeLandmark | null,
  ): AvatarFaceEyeLandmarkSnapshot | null {
    if (!eye) return null;
    return {
      bindingKey: eye.bindingKey,
      materialName: eye.materialName,
      vertexCount: eye.vertexCount,
      boundsLocal: toBoundsSnapshot(eye.bounds),
      centerLocal: toVectorSnapshot(eye.center),
      centerWorld: cloneWorldPoint(this._anchorObject, eye.center),
      projectedFrontLocal: toVectorSnapshot(eye.projectedFront),
      projectedFrontWorld: cloneWorldPoint(
        this._anchorObject,
        eye.projectedFront,
      ),
      normalizedBoxCoord: eye.normalizedBoxCoord,
      projectedBoxCoord: eye.projectedBoxCoord,
      textureRect: eye.textureRect,
    };
  }

  private _build(): void {
    const runtimeResult = buildRuntimePrimitiveBindings(this._avatar);
    this._warnings = [...runtimeResult.warnings];

    const parts = resolveAvatarFacePartEntries(
      this._avatar,
      runtimeResult.entries,
    );
    const faceBinding = parts.face;
    const eyeBindings = Array.from(
      new Set([...parts.leftEyes, ...parts.rightEyes]),
    );

    const anchorObject = this._resolveAnchorObject(
      faceBinding?.object ?? eyeBindings[0]?.object ?? null,
    );
    this._anchorObject = anchorObject;

    if (!faceBinding || !anchorObject) {
      if (!faceBinding) {
        this._warn(
          { code: "landmarks_face_skin_missing" },
          "No face skin part was detected on this avatar.",
        );
      }
      if (!anchorObject) {
        this._warn(
          { code: "landmarks_anchor_missing" },
          "No anchor object was available for face landmarks.",
        );
      }
      this._snapshot = createEmptySnapshot(
        [...this._warnings],
        [...this._issues],
      );
      return;
    }

    const faceBounds = computePrimitiveBoundsInAnchorSpace({
      avatar: this._avatar,
      binding: faceBinding,
      anchorObject,
    });
    if (!faceBounds) {
      this._warn(
        {
          code: "landmarks_face_bounds_failed",
          params: { binding: faceBinding.bindingKey },
        },
        `Unable to compute face bounds for ${faceBinding.bindingKey}.`,
      );
      this._snapshot = createEmptySnapshot(
        [...this._warnings],
        [...this._issues],
      );
      return;
    }

    this._faceBounds = faceBounds;
    this._faceBindingKey = faceBinding.bindingKey;
    this._faceMaterialName = faceBinding.materialName;
    this._frontZLocal = resolveFaceFrontZ({
      avatar: this._avatar,
      faceBounds,
    });
    this._boxHoverClearanceLocal = 0;
    this._boxHoverFrontZLocal = this._frontZLocal;

    // One primitive may hold both eyes, so islands are extracted once per
    // binding and offered to the side(s) whose part lists that binding.
    const islandsByBinding = new Map(
      eyeBindings.map((binding) => [
        binding.bindingKey,
        extractPrimitiveIslandsInAnchorSpace({
          avatar: this._avatar,
          binding,
          anchorObject,
        }),
      ]),
    );
    const eyeIslands = Array.from(islandsByBinding.values()).flat();
    const leftKeys = new Set(parts.leftEyes.map((entry) => entry.bindingKey));
    const rightKeys = new Set(parts.rightEyes.map((entry) => entry.bindingKey));

    if (eyeIslands.length === 0) {
      this._warn(
        { code: "landmarks_eyes_missing" },
        "No eye iris landmark islands were derived from the current bindings.",
      );
    } else {
      this._eyes = this._assignEyes({
        anchorObject,
        faceBounds,
        frontZLocal: this._frontZLocal,
        islands: eyeIslands,
        isLeft: (island) => leftKeys.has(island.bindingKey),
        isRight: (island) => rightKeys.has(island.bindingKey),
      });
    }

    const boxHoverFront = resolveBoxHoverFrontClearance({
      avatar: this._avatar,
      anchorObject,
      hairBindings: parts.hair,
      faceBounds,
      frontZLocal: this._frontZLocal,
      eyes: this._eyes,
    });
    this._boxHoverClearanceLocal = boxHoverFront.offsetLocal;
    this._boxHoverFrontZLocal = boxHoverFront.frontZLocal;

    this._snapshot = this.getSnapshot();
    logger.info("Init", "Resolved face landmarks", {
      faceBindingKey: this._faceBindingKey,
      faceMaterialName: this._faceMaterialName,
      eyeIslandCount: eyeIslands.length,
      hasLeftEye: Boolean(this._eyes.left),
      hasRightEye: Boolean(this._eyes.right),
      boxHoverClearanceLocal: this._boxHoverClearanceLocal,
      boxHoverFrontZLocal: this._boxHoverFrontZLocal,
    });
  }

  /**
   * Pick one iris island per side. `isLeft`/`isRight` restrict each side to
   * islands of that side's part; when one primitive holds both eyes, both
   * sides share the candidates and the eye bones decide.
   *
   * With both eye bones, an island wider than the distance between them
   * cannot be one eye (some VRChat eye meshes carry such a dome around each
   * eyeball) and is skipped, unless that leaves no island. Such meshes also
   * draw an eye in stacked layers (the iris art, a gloss, an alternative eye);
   * the landmark's `textureRect` is that of the iris art (see
   * `irisTextureRect`).
   */
  private _assignEyes(args: {
    anchorObject: THREE.Object3D;
    faceBounds: THREE.Box3;
    frontZLocal: number;
    islands: PrimitiveIsland[];
    isLeft: (island: PrimitiveIsland) => boolean;
    isRight: (island: PrimitiveIsland) => boolean;
  }): {
    left: InternalEyeLandmark | null;
    right: InternalEyeLandmark | null;
  } {
    const leftEyeNode =
      this._avatar.vrm?.humanoid?.getNormalizedBoneNode("leftEye") ?? null;
    const rightEyeNode =
      this._avatar.vrm?.humanoid?.getNormalizedBoneNode("rightEye") ?? null;
    const leftEyePoint = leftEyeNode
      ? getObjectPositionInAnchorSpace(leftEyeNode, args.anchorObject)
      : null;
    const rightEyePoint = rightEyeNode
      ? getObjectPositionInAnchorSpace(rightEyeNode, args.anchorObject)
      : null;
    const eyeSpacing =
      leftEyePoint && rightEyePoint
        ? Math.abs(leftEyePoint.x - rightEyePoint.x)
        : Infinity;

    const narrow = args.islands.filter(
      (island) => island.bounds.max.x - island.bounds.min.x < eyeSpacing,
    );
    const plausible = narrow.length > 0 ? narrow : args.islands;
    const candidates = [...plausible]
      .sort((a, b) => b.vertexCount - a.vertexCount)
      .slice(0, Math.max(2, Math.min(6, plausible.length)));
    const leftCandidates = candidates.filter(args.isLeft);
    const rightCandidates = candidates.filter(args.isRight);

    let leftIsland: PrimitiveIsland | null = null;
    let rightIsland: PrimitiveIsland | null = null;

    if (candidates.length === 1) {
      const loneIsland = candidates[0];
      const canBeLeft = args.isLeft(loneIsland);
      const canBeRight = args.isRight(loneIsland);
      if (canBeLeft !== canBeRight) {
        leftIsland = canBeLeft ? loneIsland : null;
        rightIsland = canBeRight ? loneIsland : null;
      } else if (leftEyePoint && rightEyePoint) {
        const leftDistance = loneIsland.center.distanceToSquared(leftEyePoint);
        const rightDistance =
          loneIsland.center.distanceToSquared(rightEyePoint);
        if (leftDistance <= rightDistance) {
          leftIsland = loneIsland;
        } else {
          rightIsland = loneIsland;
        }
      } else {
        leftIsland = loneIsland;
      }
    } else if (leftEyePoint && rightEyePoint) {
      let bestPair: {
        left: PrimitiveIsland;
        right: PrimitiveIsland;
        score: number;
      } | null = null;
      for (const leftCandidate of leftCandidates) {
        for (const rightCandidate of rightCandidates) {
          if (leftCandidate === rightCandidate) continue;
          const score =
            leftCandidate.center.distanceToSquared(leftEyePoint) +
            rightCandidate.center.distanceToSquared(rightEyePoint);
          if (!bestPair || score < bestPair.score) {
            bestPair = {
              left: leftCandidate,
              right: rightCandidate,
              score,
            };
          }
        }
      }
      leftIsland = bestPair?.left ?? null;
      rightIsland = bestPair?.right ?? null;
    } else {
      const byX = (a: PrimitiveIsland, b: PrimitiveIsland) =>
        a.center.x - b.center.x;
      leftIsland = [...leftCandidates].sort(byX)[0] ?? null;
      rightIsland =
        [...rightCandidates]
          .sort(byX)
          .reverse()
          .find((island) => island !== leftIsland) ?? null;
    }

    const landmarkOf = (island: PrimitiveIsland | null) =>
      island
        ? createEyeLandmarkFromIsland(
            { ...island, textureRect: irisTextureRect(island, plausible) },
            args.faceBounds,
            args.frontZLocal,
          )
        : null;
    return { left: landmarkOf(leftIsland), right: landmarkOf(rightIsland) };
  }

  private _resolveAnchorObject(
    preferredObject: THREE.Object3D | null,
  ): THREE.Object3D | null {
    return (
      this._avatar.vrm?.humanoid?.getNormalizedBoneNode("head") ??
      preferredObject ??
      this._avatar.scene
    );
  }
}

function createEyeLandmarkFromIsland(
  island: PrimitiveIsland,
  faceBounds: THREE.Box3,
  frontZLocal: number,
): InternalEyeLandmark {
  const projectedFront = island.center.clone();
  projectedFront.z = frontZLocal;

  return {
    bindingKey: island.bindingKey,
    materialName: island.materialName,
    vertexCount: island.vertexCount,
    bounds: island.bounds.clone(),
    center: island.center.clone(),
    projectedFront,
    normalizedBoxCoord: normalizePointWithinBounds(island.center, faceBounds),
    projectedBoxCoord: normalizePointWithinBounds(projectedFront, faceBounds),
    textureRect: island.textureRect,
  };
}

function resolveFaceFrontZ(args: {
  avatar: Avatar;
  faceBounds: THREE.Box3;
}): number {
  const specVersion = resolveVRMSpecVersion(args.avatar);
  if (specVersion === "0") {
    return args.faceBounds.min.z;
  }
  return args.faceBounds.max.z;
}

function resolveVRMSpecVersion(avatar: Avatar): "0" | "1" | "unknown" {
  const runtimeMetaVersion = avatar.vrm?.meta?.metaVersion;
  if (runtimeMetaVersion === "0" || runtimeMetaVersion === "1") {
    return runtimeMetaVersion;
  }

  const extensions = avatar.sourceGltf?.parser.json.extensions;
  if (extensions && typeof extensions === "object") {
    const extensionRecord = extensions as Record<string, unknown>;
    if (extensionRecord.VRMC_vrm) return "1";
    if (extensionRecord.VRM) return "0";
  }

  return "unknown";
}

function getObjectPositionInAnchorSpace(
  object: THREE.Object3D,
  anchorObject: THREE.Object3D,
): THREE.Vector3 {
  object.updateWorldMatrix(true, false);
  anchorObject.updateWorldMatrix(true, false);
  const point = new THREE.Vector3();
  object.getWorldPosition(point);
  anchorObject.worldToLocal(point);
  return point;
}

function resolveFrontAxisSign(args: {
  faceBounds: THREE.Box3;
  frontZLocal: number;
}): FrontAxisSign {
  const { faceBounds, frontZLocal } = args;
  const distanceToMin = Math.abs(frontZLocal - faceBounds.min.z);
  const distanceToMax = Math.abs(frontZLocal - faceBounds.max.z);
  return distanceToMin <= distanceToMax ? -1 : 1;
}

function resolveHairSearchWindow(args: {
  faceBounds: THREE.Box3;
  eyes: {
    left: InternalEyeLandmark | null;
    right: InternalEyeLandmark | null;
  };
}): HairFrontSearchWindow {
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  args.faceBounds.getSize(size);
  args.faceBounds.getCenter(center);

  const eyeYValues = [
    args.eyes.left?.projectedFront.y,
    args.eyes.right?.projectedFront.y,
  ].filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  const eyeLineY =
    eyeYValues.length > 0
      ? eyeYValues.reduce((sum, value) => sum + value, 0) / eyeYValues.length
      : center.y;

  return {
    minX: args.faceBounds.min.x - size.x * HAIR_SEARCH_X_PADDING_RATIO,
    maxX: args.faceBounds.max.x + size.x * HAIR_SEARCH_X_PADDING_RATIO,
    minY: eyeLineY,
    maxY: args.faceBounds.max.y + size.y * HAIR_SEARCH_Y_PADDING_RATIO,
  };
}

function isPointWithinHairSearchWindow(
  point: THREE.Vector3,
  searchWindow: HairFrontSearchWindow,
): boolean {
  return (
    point.x >= searchWindow.minX &&
    point.x <= searchWindow.maxX &&
    point.y >= searchWindow.minY &&
    point.y <= searchWindow.maxY
  );
}

function preparePrimitiveVertexScan(args: {
  avatar: Avatar;
  binding: RuntimePrimitiveBindingEntry;
  anchorObject: THREE.Object3D;
}): {
  anchorObject: THREE.Object3D;
  meshObject: THREE.Mesh;
  position: THREE.BufferAttribute;
  index: THREE.BufferAttribute | null;
  start: number;
  count: number;
} | null {
  const geometry = args.binding.object.geometry;
  if (!(geometry instanceof THREE.BufferGeometry)) {
    return null;
  }

  const position = geometry.getAttribute("position");
  if (!(position instanceof THREE.BufferAttribute) || position.itemSize < 3) {
    return null;
  }

  const index = geometry.getIndex();
  const range = resolvePrimitiveVertexRange(args.avatar, args.binding);
  const start = Math.max(0, range?.start ?? 0);
  const totalCount = index ? index.count : position.count;
  const maxCount = totalCount - start;
  const count =
    range?.count === null || range?.count === undefined
      ? maxCount
      : Math.max(0, Math.min(range.count, maxCount));
  if (count <= 0) {
    return null;
  }

  const meshObject = args.binding.object;
  meshObject.updateWorldMatrix(true, false);
  args.anchorObject.updateWorldMatrix(true, false);

  return {
    anchorObject: args.anchorObject,
    meshObject,
    position,
    index,
    start,
    count,
  };
}

function readVertexPositionInAnchorSpace(args: {
  anchorObject: THREE.Object3D;
  meshObject: THREE.Mesh;
  position: THREE.BufferAttribute;
  vertexIndex: number;
  target: THREE.Vector3;
}): THREE.Vector3 {
  readVertexPosition(
    args.meshObject,
    args.position,
    args.vertexIndex,
    args.target,
  );
  args.meshObject.localToWorld(args.target);
  args.anchorObject.worldToLocal(args.target);
  return args.target;
}

function samplePrimitiveFrontInWindow(args: {
  avatar: Avatar;
  binding: RuntimePrimitiveBindingEntry;
  anchorObject: THREE.Object3D;
  searchWindow: HairFrontSearchWindow;
  frontSign: FrontAxisSign;
  sampleLimit: number;
}): HairFrontSample | null {
  const prepared = preparePrimitiveVertexScan(args);
  if (!prepared) {
    return null;
  }

  const sampleCount = Math.min(args.sampleLimit, prepared.count);
  if (sampleCount <= 0) {
    return null;
  }

  const point = new THREE.Vector3();
  let pointCount = 0;
  let maxSignedFront = -Infinity;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const offset = Math.min(
      prepared.count - 1,
      Math.floor((sampleIndex * prepared.count) / sampleCount),
    );
    const sourceIndex = prepared.start + offset;
    const vertexIndex = prepared.index
      ? prepared.index.getX(sourceIndex)
      : sourceIndex;
    readVertexPositionInAnchorSpace({
      anchorObject: prepared.anchorObject,
      meshObject: prepared.meshObject,
      position: prepared.position,
      vertexIndex,
      target: point,
    });
    if (!isPointWithinHairSearchWindow(point, args.searchWindow)) {
      continue;
    }

    pointCount += 1;
    maxSignedFront = Math.max(maxSignedFront, point.z * args.frontSign);
  }

  return pointCount > 0
    ? {
        maxSignedFront,
        pointCount,
      }
    : null;
}

function computePrimitiveMaxFrontInWindow(args: {
  avatar: Avatar;
  binding: RuntimePrimitiveBindingEntry;
  anchorObject: THREE.Object3D;
  searchWindow: HairFrontSearchWindow;
  frontSign: FrontAxisSign;
}): number | null {
  const prepared = preparePrimitiveVertexScan(args);
  if (!prepared) {
    return null;
  }

  const seenVertexIndices = prepared.index ? new Set<number>() : null;
  const point = new THREE.Vector3();
  let hasPoint = false;
  let maxSignedFront = -Infinity;

  for (let offset = 0; offset < prepared.count; offset += 1) {
    const sourceIndex = prepared.start + offset;
    const vertexIndex = prepared.index
      ? prepared.index.getX(sourceIndex)
      : sourceIndex;
    if (seenVertexIndices) {
      if (seenVertexIndices.has(vertexIndex)) {
        continue;
      }
      seenVertexIndices.add(vertexIndex);
    }

    readVertexPositionInAnchorSpace({
      anchorObject: prepared.anchorObject,
      meshObject: prepared.meshObject,
      position: prepared.position,
      vertexIndex,
      target: point,
    });
    if (!isPointWithinHairSearchWindow(point, args.searchWindow)) {
      continue;
    }

    hasPoint = true;
    maxSignedFront = Math.max(maxSignedFront, point.z * args.frontSign);
  }

  return hasPoint ? maxSignedFront : null;
}

function resolveBoxHoverFrontClearance(args: {
  avatar: Avatar;
  anchorObject: THREE.Object3D;
  /** The hair part: box hovers clear the hair in front of the forehead. */
  hairBindings: RuntimePrimitiveBindingEntry[];
  faceBounds: THREE.Box3;
  frontZLocal: number;
  eyes: {
    left: InternalEyeLandmark | null;
    right: InternalEyeLandmark | null;
  };
}): {
  offsetLocal: number;
  frontZLocal: number;
} {
  const frontSign = resolveFrontAxisSign({
    faceBounds: args.faceBounds,
    frontZLocal: args.frontZLocal,
  });
  const faceFrontSigned = args.frontZLocal * frontSign;
  const searchWindow = resolveHairSearchWindow({
    faceBounds: args.faceBounds,
    eyes: args.eyes,
  });
  const hairBindings = args.hairBindings;
  if (hairBindings.length === 0) {
    return {
      offsetLocal: 0,
      frontZLocal: args.frontZLocal,
    };
  }

  const retainedBindings = hairBindings
    .map((binding) => {
      const sample = samplePrimitiveFrontInWindow({
        avatar: args.avatar,
        binding,
        anchorObject: args.anchorObject,
        searchWindow,
        frontSign,
        sampleLimit: HAIR_COARSE_SAMPLE_LIMIT,
      });
      if (!sample) {
        return null;
      }
      return {
        binding,
        maxSignedFront: sample.maxSignedFront,
      };
    })
    .filter(
      (
        value,
      ): value is {
        binding: RuntimePrimitiveBindingEntry;
        maxSignedFront: number;
      } => value !== null,
    )
    .sort((a, b) => b.maxSignedFront - a.maxSignedFront)
    .slice(0, MAX_RETAINED_HAIR_BINDINGS);

  if (retainedBindings.length === 0) {
    return {
      offsetLocal: 0,
      frontZLocal: args.frontZLocal,
    };
  }

  let hairFrontSigned = faceFrontSigned;
  let foundHairFront = false;

  retainedBindings.forEach(({ binding }) => {
    const maxSignedFront = computePrimitiveMaxFrontInWindow({
      avatar: args.avatar,
      binding,
      anchorObject: args.anchorObject,
      searchWindow,
      frontSign,
    });
    if (maxSignedFront === null) {
      return;
    }
    hairFrontSigned = Math.max(hairFrontSigned, maxSignedFront);
    foundHairFront = true;
  });

  if (!foundHairFront) {
    return {
      offsetLocal: 0,
      frontZLocal: args.frontZLocal,
    };
  }

  const clearance = Math.max(0, hairFrontSigned - faceFrontSigned);
  if (clearance <= EPSILON) {
    return {
      offsetLocal: 0,
      frontZLocal: args.frontZLocal,
    };
  }

  const faceDepth = Math.max(
    EPSILON,
    args.faceBounds.max.z - args.faceBounds.min.z,
  );
  const margin = Math.max(
    HAIR_CLEARANCE_MARGIN_MIN,
    faceDepth * HAIR_CLEARANCE_MARGIN_DEPTH_RATIO,
  );
  const offsetLocal = clearance + margin;
  return {
    offsetLocal,
    frontZLocal: args.frontZLocal + frontSign * offsetLocal,
  };
}

function extractPrimitiveIslandsInAnchorSpace(args: {
  avatar: Avatar;
  binding: RuntimePrimitiveBindingEntry;
  anchorObject: THREE.Object3D;
}): PrimitiveIsland[] {
  const primitiveData = collectPrimitiveData({
    avatar: args.avatar,
    binding: args.binding,
    anchorObject: args.anchorObject,
  });
  if (!primitiveData) return [];

  const uv = args.binding.object.geometry.getAttribute("uv");
  const textureRectOf = (vertexIndices: readonly number[]) =>
    uv instanceof THREE.BufferAttribute
      ? computeTextureRect(uv, vertexIndices)
      : null;

  if (!primitiveData.indexed) {
    const points = primitiveData.orderedPoints;
    const bounds = createBoxFromPoints(points);
    if (!bounds) return [];
    return [
      {
        bindingKey: args.binding.bindingKey,
        materialName: args.binding.materialName,
        vertexCount: points.length,
        bounds,
        center: computeCentroid(points),
        textureRect: textureRectOf(primitiveData.uniqueVertexIndices),
      },
    ];
  }

  const unionFind = new UnionFind();
  primitiveData.uniqueVertexIndices.forEach((vertexIndex) => {
    unionFind.add(vertexIndex);
  });

  for (
    let offset = 0;
    offset + 2 < primitiveData.orderedVertexIndices.length;
  ) {
    const a = primitiveData.orderedVertexIndices[offset];
    const b = primitiveData.orderedVertexIndices[offset + 1];
    const c = primitiveData.orderedVertexIndices[offset + 2];
    unionFind.union(a, b);
    unionFind.union(b, c);
    unionFind.union(a, c);
    offset += 3;
  }

  const components = new Map<number, number[]>();
  primitiveData.uniqueVertexIndices.forEach((vertexIndex) => {
    const root = unionFind.find(vertexIndex);
    const members = components.get(root) ?? [];
    members.push(vertexIndex);
    components.set(root, members);
  });

  const islands = Array.from(components.values())
    .map((componentVertexIndices) => {
      const points = componentVertexIndices
        .map(
          (vertexIndex) => primitiveData.pointsByIndex.get(vertexIndex) ?? null,
        )
        .filter((value): value is THREE.Vector3 => value !== null);
      const bounds = createBoxFromPoints(points);
      if (!bounds) return null;
      return {
        bindingKey: args.binding.bindingKey,
        materialName: args.binding.materialName,
        vertexCount: points.length,
        bounds,
        center: computeCentroid(points),
        textureRect: textureRectOf(componentVertexIndices),
      } satisfies PrimitiveIsland;
    })
    .filter((value): value is PrimitiveIsland => value !== null);

  return islands.sort((a, b) => b.vertexCount - a.vertexCount);
}

/**
 * The texture rectangle of an eye's iris art: of the islands layered over
 * `eye` (same primitive, centre inside its outline, at least half its width
 * and height), the one with the largest texture area. A small patch mapped to
 * a large texture area (a gloss gradient) is thus not taken for the iris.
 */
function irisTextureRect(
  eye: PrimitiveIsland,
  islands: readonly PrimitiveIsland[],
): AvatarFaceTextureRect | null {
  let best = eye.textureRect;
  for (const island of islands) {
    const rect = island.textureRect;
    const size = island.bounds.getSize(new THREE.Vector3());
    const eyeSize = eye.bounds.getSize(new THREE.Vector3());
    if (
      !rect ||
      island.bindingKey !== eye.bindingKey ||
      island.center.x < eye.bounds.min.x ||
      island.center.x > eye.bounds.max.x ||
      island.center.y < eye.bounds.min.y ||
      island.center.y > eye.bounds.max.y ||
      size.x < eyeSize.x * 0.5 ||
      size.y < eyeSize.y * 0.5
    ) {
      continue;
    }
    if (!best || rect.width * rect.height > best.width * best.height) {
      best = rect;
    }
  }
  return best;
}

/** The UV bounds of some vertices, as a texture-space rectangle. */
function computeTextureRect(
  uv: THREE.BufferAttribute,
  vertexIndices: readonly number[],
): AvatarFaceTextureRect | null {
  if (vertexIndices.length === 0) return null;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const vertexIndex of vertexIndices) {
    const u = uv.getX(vertexIndex);
    const v = uv.getY(vertexIndex);
    minU = Math.min(minU, u);
    minV = Math.min(minV, v);
    maxU = Math.max(maxU, u);
    maxV = Math.max(maxV, v);
  }
  return { x: minU, y: minV, width: maxU - minU, height: maxV - minV };
}

function computePrimitiveBoundsInAnchorSpace(args: {
  avatar: Avatar;
  binding: RuntimePrimitiveBindingEntry;
  anchorObject: THREE.Object3D;
}): THREE.Box3 | null {
  const primitiveData = collectPrimitiveData(args);
  if (!primitiveData) return null;
  return createBoxFromPoints(primitiveData.orderedPoints);
}
