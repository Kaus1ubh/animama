import * as THREE from "three";

import type { Avatar } from "../Avatar";
import type {
  AvatarFaceTextureAnchorSnapshot,
  AvatarFaceTextureAnchorsSnapshot,
  AvatarFaceTextureAnchorSource,
  AvatarFaceTextureFlattenRegionSnapshot,
  AvatarFaceTextureReferenceSize,
} from "./texture-anchor-types";
import type {
  AvatarFaceEyeLandmarkSnapshot,
  AvatarFaceLandmarkBounds,
  AvatarFaceLandmarkVector,
  AvatarFaceLandmarksSnapshot,
} from "./landmark-types";
import type { AvatarVFXSide } from "./types";
import {
  collectPrimitiveData,
  type RuntimePrimitiveBindingEntry,
} from "./avatarPrimitiveUtils";
import { resolveFaceTargetBinding } from "./avatarRuntimeTargeting";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";
import { createLogger } from "@/lib/logger";

const logger = createLogger("AvatarFaceTextureAnchors");
const EPSILON = 1e-6;
const MOUTH_EXPRESSION_NAMES = ["aa", "ee", "ih", "oh", "ou"] as const;
const MOUTH_SCORE_RATIO = 0.35;
const MOUTH_TOP_FALLBACK_COUNT = 48;
const UNDER_EYE_Y_OFFSET_RATIO = 0.12;
const UNDER_EYE_WIDTH_RATIO = 0.75;
const UNDER_EYE_HEIGHT_RATIO = 0.4;
const BLUSH_MOUTH_Y_LERP = 0.18;
const BLUSH_Y_OFFSET_RATIO = 0.2;
const BLUSH_WIDTH_RATIO = 0.75;
const BLUSH_HEIGHT_RATIO = 0.45;
const MOUTH_REFERENCE_INFLATE_RATIO = 1;
const FLATTEN_EYE_WIDTH_RATIO = 2.65;
const FLATTEN_EYE_HEIGHT_RATIO = 1.35;
const FLATTEN_EYE_Y_OFFSET_RATIO = 0.28;
const FLATTEN_MOUTH_WIDTH_RATIO = 1.35;
const FLATTEN_MOUTH_HEIGHT_RATIO = 1.7;
const FLATTEN_SAMPLE_WIDTH_RATIO = 0.2;
const FLATTEN_SAMPLE_HEIGHT_RATIO = 0.14;

type FaceProjectionData = {
  bindingKey: string;
  materialName: string | null;
  anchorObject: THREE.Object3D;
  meshObject: THREE.Mesh;
  position: THREE.BufferAttribute;
  uv: THREE.BufferAttribute;
  index: THREE.BufferAttribute | null;
  start: number;
  count: number;
  orderedVertexIndices: number[];
  pointsByIndex: Map<number, THREE.Vector3>;
  uniqueVertexIndices: number[];
  faceBounds: THREE.Box3;
};

type MouthAnchorCandidate = {
  localPoint: THREE.Vector3;
  referenceSizeLocal: AvatarFaceTextureReferenceSize;
  source: AvatarFaceTextureAnchorSource;
};

type ProjectedUvPoint = {
  localPoint: THREE.Vector3;
  uv: THREE.Vector2;
};

type MorphTargetBindLike = {
  primitives: THREE.Mesh[];
  index: number;
  weight: number;
};

type MouthSearchWindow = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function createEmptySnapshot(
  warnings: string[] = [],
): AvatarFaceTextureAnchorsSnapshot {
  return {
    status: "unavailable",
    warnings,
    faceBindingKey: null,
    faceMaterialName: null,
    anchors: {
      undereye: {
        left: null,
        right: null,
      },
      blush: {
        left: null,
        right: null,
      },
      mouth: {
        center: null,
      },
    },
    flatten: {
      sample: {
        center: null,
      },
      eyes: {
        left: null,
        right: null,
      },
      mouth: {
        center: null,
      },
    },
  };
}

function toVector3(value: AvatarFaceLandmarkVector): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z);
}

function toVectorSnapshot(value: THREE.Vector3): AvatarFaceLandmarkVector {
  return {
    x: value.x,
    y: value.y,
    z: value.z,
  };
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

function toBox3(bounds: AvatarFaceLandmarkBounds): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
    new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
  );
}

function midpoint(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
  return a.clone().lerp(b, 0.5);
}

function clampMin(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= EPSILON) {
    return fallback;
  }
  return value;
}

function computeBoundsFromPoints(
  points: readonly THREE.Vector3[],
): THREE.Box3 | null {
  if (points.length === 0) return null;
  const bounds = new THREE.Box3();
  let hasPoint = false;
  points.forEach((point) => {
    if (!hasPoint) {
      bounds.min.copy(point);
      bounds.max.copy(point);
      hasPoint = true;
    } else {
      bounds.expandByPoint(point);
    }
  });
  return hasPoint ? bounds : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function getMorphTargetBinds(expression: unknown): MorphTargetBindLike[] {
  if (!isRecord(expression) || !Array.isArray(expression.binds)) {
    return [];
  }
  return expression.binds
    .map((bind) => {
      if (!isRecord(bind) || typeof bind.index !== "number") {
        return null;
      }
      const primitives = Array.isArray(bind.primitives)
        ? bind.primitives.filter(
            (value): value is THREE.Mesh => value instanceof THREE.Mesh,
          )
        : [];
      if (primitives.length === 0) {
        return null;
      }
      return {
        primitives,
        index: bind.index,
        weight:
          typeof bind.weight === "number" && Number.isFinite(bind.weight)
            ? bind.weight
            : 1,
      } satisfies MorphTargetBindLike;
    })
    .filter((value): value is MorphTargetBindLike => value !== null);
}

function resolveEyeMidpoint(
  snapshot: AvatarFaceLandmarksSnapshot,
): THREE.Vector3 | null {
  const leftEye = snapshot.eyes.left;
  const rightEye = snapshot.eyes.right;
  if (!leftEye || !rightEye) return null;
  return midpoint(
    toVector3(leftEye.projectedFrontLocal),
    toVector3(rightEye.projectedFrontLocal),
  );
}

function resolveInterocularDistance(
  snapshot: AvatarFaceLandmarksSnapshot,
): number | null {
  const leftEye = snapshot.eyes.left;
  const rightEye = snapshot.eyes.right;
  if (!leftEye || !rightEye) return null;
  return Math.abs(leftEye.centerLocal.x - rightEye.centerLocal.x);
}

function scaleReferenceSize(
  value: AvatarFaceTextureReferenceSize,
  scaleX: number,
  scaleY: number,
): AvatarFaceTextureReferenceSize {
  return {
    width: clampMin(value.width * scaleX, 0.01),
    height: clampMin(value.height * scaleY, 0.01),
  };
}

function resolveMouthSearchWindow(args: {
  faceBounds: THREE.Box3;
  snapshot: AvatarFaceLandmarksSnapshot;
}): MouthSearchWindow | null {
  const eyeMid = resolveEyeMidpoint(args.snapshot);
  const interocular = resolveInterocularDistance(args.snapshot);
  if (!eyeMid || !interocular) return null;

  const faceWidth = Math.max(
    EPSILON,
    args.faceBounds.max.x - args.faceBounds.min.x,
  );
  const faceHeight = Math.max(
    EPSILON,
    args.faceBounds.max.y - args.faceBounds.min.y,
  );
  const xHalfRange = Math.max(interocular * 0.45, faceWidth * 0.18);
  const minY = args.faceBounds.min.y + faceHeight * 0.12;
  const maxY = eyeMid.y - Math.max(interocular * 0.12, faceHeight * 0.16);

  return {
    minX: eyeMid.x - xHalfRange,
    maxX: eyeMid.x + xHalfRange,
    minY,
    maxY,
  };
}

function isPointWithinMouthSearchWindow(
  point: THREE.Vector3,
  window: MouthSearchWindow,
): boolean {
  return (
    point.x >= window.minX &&
    point.x <= window.maxX &&
    point.y >= window.minY &&
    point.y <= window.maxY
  );
}

export class AvatarFaceTextureAnchors {
  private readonly _avatar: Avatar;
  private _snapshot: AvatarFaceTextureAnchorsSnapshot = createEmptySnapshot();
  private _warnings: string[] = [];

  constructor(avatar: Avatar) {
    this._avatar = avatar;
    this._build();
  }

  getSnapshot(): AvatarFaceTextureAnchorsSnapshot {
    return this._snapshot;
  }

  dispose(): void {
    this._warnings = [];
    this._snapshot = createEmptySnapshot();
  }

  private _build(): void {
    const faceLandmarks = this._avatar.faceLandmarks?.getSnapshot() ?? null;
    const anchorObject = this._avatar.faceLandmarks?.getAnchorObject() ?? null;
    if (!faceLandmarks || faceLandmarks.status !== "ready" || !anchorObject) {
      this._warnings.push(
        "Face landmarks are unavailable for texture anchors.",
      );
      this._snapshot = createEmptySnapshot([...this._warnings]);
      return;
    }

    const runtimeResult = buildRuntimePrimitiveBindings(this._avatar);
    this._warnings.push(...runtimeResult.warnings);
    const faceBinding = resolveFaceTargetBinding({
      sourceKey: this._avatar.sourceKey,
      sourceUrl: this._avatar.sourceUrl,
      entries: runtimeResult.entries,
    });
    if (!faceBinding) {
      this._warnings.push(
        "No face skin binding matched the current heuristics.",
      );
      this._snapshot = createEmptySnapshot([...this._warnings]);
      return;
    }

    const projection = this._prepareFaceProjectionData({
      binding: faceBinding,
      anchorObject,
      faceLandmarks,
    });
    if (!projection) {
      this._warnings.push(
        "Unable to prepare face texture anchor projection data.",
      );
      this._snapshot = createEmptySnapshot([...this._warnings]);
      return;
    }

    const mouth = this._resolveMouthAnchor({
      projection,
      faceLandmarks,
    });
    if (!mouth) {
      this._warnings.push("Unable to resolve a mouth texture anchor.");
    }

    const flattenSample = this._resolveFlattenSampleRegion({
      projection,
      faceLandmarks,
    });
    const flattenMouth = mouth
      ? this._createFlattenRegionSnapshot({
          region: "mouth",
          side: null,
          source: mouth.source,
          localSeedPoint: mouth.localPoint,
          referenceSizeLocal: scaleReferenceSize(
            mouth.referenceSizeLocal,
            FLATTEN_MOUTH_WIDTH_RATIO,
            FLATTEN_MOUTH_HEIGHT_RATIO,
          ),
          projection,
        })
      : null;

    const snapshot: AvatarFaceTextureAnchorsSnapshot = {
      status: "ready",
      warnings: [...this._warnings],
      faceBindingKey: faceBinding.bindingKey,
      faceMaterialName: faceBinding.materialName,
      anchors: {
        undereye: {
          left: this._resolveUnderEyeAnchor({
            side: "left",
            eye: faceLandmarks.eyes.left,
            projection,
          }),
          right: this._resolveUnderEyeAnchor({
            side: "right",
            eye: faceLandmarks.eyes.right,
            projection,
          }),
        },
        blush: {
          left: this._resolveBlushAnchor({
            side: "left",
            eye: faceLandmarks.eyes.left,
            mouth,
            projection,
          }),
          right: this._resolveBlushAnchor({
            side: "right",
            eye: faceLandmarks.eyes.right,
            mouth,
            projection,
          }),
        },
        mouth: {
          center: mouth
            ? this._createAnchorSnapshot({
                anchor: "mouth",
                side: null,
                source: mouth.source,
                localSeedPoint: mouth.localPoint,
                referenceSizeLocal: mouth.referenceSizeLocal,
                projection,
              })
            : null,
        },
      },
      flatten: {
        sample: {
          center: flattenSample,
        },
        eyes: {
          left: this._resolveFlattenEyeRegion({
            side: "left",
            eye: faceLandmarks.eyes.left,
            projection,
          }),
          right: this._resolveFlattenEyeRegion({
            side: "right",
            eye: faceLandmarks.eyes.right,
            projection,
          }),
        },
        mouth: {
          center: flattenMouth,
        },
      },
    };

    this._snapshot = snapshot;
    logger.info("Init", "Resolved face texture anchors", {
      faceBindingKey: snapshot.faceBindingKey,
      hasFlattenSample: Boolean(snapshot.flatten.sample.center),
      hasFlattenEyeLeft: Boolean(snapshot.flatten.eyes.left),
      hasFlattenEyeRight: Boolean(snapshot.flatten.eyes.right),
      hasFlattenMouth: Boolean(snapshot.flatten.mouth.center),
      hasMouth: Boolean(snapshot.anchors.mouth.center),
      hasUnderEyeLeft: Boolean(snapshot.anchors.undereye.left),
      hasUnderEyeRight: Boolean(snapshot.anchors.undereye.right),
      hasBlushLeft: Boolean(snapshot.anchors.blush.left),
      hasBlushRight: Boolean(snapshot.anchors.blush.right),
      warnings: snapshot.warnings,
    });
  }

  private _prepareFaceProjectionData(args: {
    binding: RuntimePrimitiveBindingEntry;
    anchorObject: THREE.Object3D;
    faceLandmarks: AvatarFaceLandmarksSnapshot;
  }): FaceProjectionData | null {
    const geometry = args.binding.object.geometry;
    if (!(geometry instanceof THREE.BufferGeometry)) {
      return null;
    }
    const uv = geometry.getAttribute("uv");
    if (!(uv instanceof THREE.BufferAttribute) || uv.itemSize < 2) {
      return null;
    }
    const primitiveData = collectPrimitiveData({
      avatar: this._avatar,
      binding: args.binding,
      anchorObject: args.anchorObject,
    });
    if (!primitiveData || primitiveData.orderedVertexIndices.length === 0) {
      return null;
    }
    const position = geometry.getAttribute("position");
    if (!(position instanceof THREE.BufferAttribute) || position.itemSize < 3) {
      return null;
    }

    const index = geometry.getIndex();
    const count = primitiveData.orderedVertexIndices.length;
    const faceBounds = args.faceLandmarks.faceBoundsLocal
      ? toBox3(args.faceLandmarks.faceBoundsLocal)
      : computeBoundsFromPoints(primitiveData.orderedPoints);
    if (!faceBounds) {
      return null;
    }

    return {
      bindingKey: args.binding.bindingKey,
      materialName: args.binding.materialName,
      anchorObject: args.anchorObject,
      meshObject: args.binding.object,
      position,
      uv,
      index,
      start: 0,
      count,
      orderedVertexIndices: primitiveData.orderedVertexIndices,
      pointsByIndex: primitiveData.pointsByIndex,
      uniqueVertexIndices: primitiveData.uniqueVertexIndices,
      faceBounds,
    };
  }

  private _resolveUnderEyeAnchor(args: {
    side: AvatarVFXSide;
    eye: AvatarFaceEyeLandmarkSnapshot | null;
    projection: FaceProjectionData;
  }): AvatarFaceTextureAnchorSnapshot | null {
    const { eye, side, projection } = args;
    if (!eye) return null;
    const localSeedPoint = toVector3(eye.centerLocal);
    localSeedPoint.y =
      eye.boundsLocal.min.y - eye.boundsLocal.size.y * UNDER_EYE_Y_OFFSET_RATIO;
    return this._createAnchorSnapshot({
      anchor: "undereye",
      side,
      source: "geometric",
      localSeedPoint,
      referenceSizeLocal: {
        width: clampMin(eye.boundsLocal.size.x * UNDER_EYE_WIDTH_RATIO, 0.02),
        height: clampMin(eye.boundsLocal.size.y * UNDER_EYE_HEIGHT_RATIO, 0.02),
      },
      projection,
    });
  }

  private _resolveBlushAnchor(args: {
    side: AvatarVFXSide;
    eye: AvatarFaceEyeLandmarkSnapshot | null;
    mouth: MouthAnchorCandidate | null;
    projection: FaceProjectionData;
  }): AvatarFaceTextureAnchorSnapshot | null {
    const { eye, mouth, projection, side } = args;
    if (!eye || !mouth) return null;
    const eyePoint = toVector3(eye.centerLocal);

    const lowerEyeY =
      eye.boundsLocal.min.y - eye.boundsLocal.size.y * BLUSH_Y_OFFSET_RATIO;
    const localSeedPoint = new THREE.Vector3(
      eyePoint.x,
      THREE.MathUtils.lerp(lowerEyeY, mouth.localPoint.y, BLUSH_MOUTH_Y_LERP),
      eyePoint.z,
    );

    return this._createAnchorSnapshot({
      anchor: "blush",
      side,
      source: "geometric",
      localSeedPoint,
      referenceSizeLocal: {
        width: clampMin(eye.boundsLocal.size.x * BLUSH_WIDTH_RATIO, 0.03),
        height: clampMin(eye.boundsLocal.size.y * BLUSH_HEIGHT_RATIO, 0.03),
      },
      projection,
    });
  }

  private _resolveFlattenEyeRegion(args: {
    side: AvatarVFXSide;
    eye: AvatarFaceEyeLandmarkSnapshot | null;
    projection: FaceProjectionData;
  }): AvatarFaceTextureFlattenRegionSnapshot | null {
    const { eye, projection, side } = args;
    if (!eye) return null;
    const referenceSizeLocal = {
      width: clampMin(eye.boundsLocal.size.x * FLATTEN_EYE_WIDTH_RATIO, 0.03),
      height: clampMin(eye.boundsLocal.size.y * FLATTEN_EYE_HEIGHT_RATIO, 0.03),
    };
    const baseSeedPoint = toVector3(eye.centerLocal);
    const baseProjected = this._projectPointToFaceSurface(
      projection,
      baseSeedPoint,
    );
    if (!baseProjected) return null;
    const referenceSizeUv = this._projectReferenceSizeUv({
      projection,
      localPoint: baseProjected.localPoint,
      referenceSizeLocal,
    });
    const offsetUvV = THREE.MathUtils.clamp(
      baseProjected.uv.y + referenceSizeUv.height * FLATTEN_EYE_Y_OFFSET_RATIO,
      0,
      1,
    );

    return {
      region: "eye",
      side,
      source: "geometric",
      localPoint: toVectorSnapshot(baseProjected.localPoint),
      worldPoint: cloneWorldPoint(
        projection.anchorObject,
        baseProjected.localPoint,
      ),
      uv: {
        u: baseProjected.uv.x,
        v: offsetUvV,
      },
      referenceSizeLocal,
      // Apply the vertical tweak in UV space so authored values move smoothly
      // instead of snapping between a few projected face triangles.
      referenceSizeUv,
    };
  }

  private _resolveFlattenSampleRegion(args: {
    projection: FaceProjectionData;
    faceLandmarks: AvatarFaceLandmarksSnapshot;
  }): AvatarFaceTextureFlattenRegionSnapshot | null {
    const eyeMid = resolveEyeMidpoint(args.faceLandmarks);
    const interocular = resolveInterocularDistance(args.faceLandmarks);
    if (!eyeMid || !interocular) {
      return null;
    }
    return this._createFlattenRegionSnapshot({
      region: "sample",
      side: null,
      source: "geometric",
      localSeedPoint: eyeMid,
      referenceSizeLocal: {
        width: clampMin(interocular * FLATTEN_SAMPLE_WIDTH_RATIO, 0.02),
        height: clampMin(interocular * FLATTEN_SAMPLE_HEIGHT_RATIO, 0.02),
      },
      projection: args.projection,
    });
  }

  private _resolveMouthAnchor(args: {
    projection: FaceProjectionData;
    faceLandmarks: AvatarFaceLandmarksSnapshot;
  }): MouthAnchorCandidate | null {
    const expressionAnchor = this._resolveExpressionMouthAnchor(args);
    if (expressionAnchor) {
      return expressionAnchor;
    }
    return this._resolveFallbackMouthAnchor(args);
  }

  private _resolveExpressionMouthAnchor(args: {
    projection: FaceProjectionData;
    faceLandmarks: AvatarFaceLandmarksSnapshot;
  }): MouthAnchorCandidate | null {
    const expressionManager = this._avatar.vrm?.expressionManager;
    if (!expressionManager) return null;

    const faceBounds = args.projection.faceBounds;
    const mouthWindow = resolveMouthSearchWindow({
      faceBounds,
      snapshot: args.faceLandmarks,
    });
    const interocular = resolveInterocularDistance(args.faceLandmarks);
    if (!mouthWindow || !interocular) {
      return null;
    }

    const geometry = args.projection.meshObject.geometry;
    if (!(geometry instanceof THREE.BufferGeometry)) {
      return null;
    }
    const morphPositions = geometry.morphAttributes.position;
    if (!Array.isArray(morphPositions) || morphPositions.length === 0) {
      return null;
    }

    const candidateVertexIndices = args.projection.uniqueVertexIndices.filter(
      (vertexIndex) => {
        const point = args.projection.pointsByIndex.get(vertexIndex) ?? null;
        return point
          ? isPointWithinMouthSearchWindow(point, mouthWindow)
          : false;
      },
    );
    if (candidateVertexIndices.length === 0) {
      return null;
    }

    const scores = new Map<number, number>();
    const basePoint = new THREE.Vector3();
    const morphPoint = new THREE.Vector3();

    MOUTH_EXPRESSION_NAMES.forEach((expressionName) => {
      const expression = expressionManager.getExpression(expressionName);
      getMorphTargetBinds(expression).forEach((bind) => {
        if (!this._bindTargetsFaceMesh(bind, args.projection.meshObject)) {
          return;
        }
        const morphAttribute = morphPositions[bind.index];
        if (
          !(morphAttribute instanceof THREE.BufferAttribute) ||
          morphAttribute.itemSize < 3
        ) {
          return;
        }
        const bindWeight = Math.abs(bind.weight) || 1;
        candidateVertexIndices.forEach((vertexIndex) => {
          basePoint.fromBufferAttribute(args.projection.position, vertexIndex);
          morphPoint.fromBufferAttribute(morphAttribute, vertexIndex);
          if (!geometry.morphTargetsRelative) {
            morphPoint.sub(basePoint);
          }
          const score = morphPoint.length() * bindWeight;
          if (score <= EPSILON) return;
          scores.set(vertexIndex, (scores.get(vertexIndex) ?? 0) + score);
        });
      });
    });

    if (scores.size === 0) {
      return null;
    }

    const sortedEntries = Array.from(scores.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    const maxScore = sortedEntries[0]?.[1] ?? 0;
    if (maxScore <= EPSILON) {
      return null;
    }

    let activeEntries = sortedEntries.filter(
      (entry) => entry[1] >= maxScore * MOUTH_SCORE_RATIO,
    );
    if (activeEntries.length < 3) {
      activeEntries = sortedEntries.slice(
        0,
        Math.min(MOUTH_TOP_FALLBACK_COUNT, sortedEntries.length),
      );
    }
    if (activeEntries.length < 3) {
      return null;
    }

    const points: THREE.Vector3[] = [];
    const centroid = new THREE.Vector3();
    let totalWeight = 0;
    activeEntries.forEach(([vertexIndex, score]) => {
      const point = args.projection.pointsByIndex.get(vertexIndex) ?? null;
      if (!point) return;
      points.push(point);
      centroid.addScaledVector(point, score);
      totalWeight += score;
    });

    if (points.length < 3 || totalWeight <= EPSILON) {
      return null;
    }

    centroid.multiplyScalar(1 / totalWeight);
    const bounds = computeBoundsFromPoints(points);
    if (!bounds) return null;
    const size = new THREE.Vector3();
    bounds.getSize(size);
    return {
      localPoint: centroid,
      referenceSizeLocal: {
        width: Math.max(
          size.x * MOUTH_REFERENCE_INFLATE_RATIO,
          interocular * 0.28,
        ),
        height: Math.max(
          size.y * MOUTH_REFERENCE_INFLATE_RATIO,
          interocular * 0.14,
        ),
      },
      source: "expression",
    };
  }

  private _resolveFallbackMouthAnchor(args: {
    projection: FaceProjectionData;
    faceLandmarks: AvatarFaceLandmarksSnapshot;
  }): MouthAnchorCandidate | null {
    const eyeMid = resolveEyeMidpoint(args.faceLandmarks);
    const interocular = resolveInterocularDistance(args.faceLandmarks);
    if (!eyeMid || !interocular) {
      return null;
    }

    const faceBounds = args.projection.faceBounds;
    const faceHeight = Math.max(EPSILON, faceBounds.max.y - faceBounds.min.y);
    const faceWidth = Math.max(EPSILON, faceBounds.max.x - faceBounds.min.x);
    const y = Math.max(
      faceBounds.min.y + faceHeight * 0.16,
      eyeMid.y - interocular * 0.78,
    );
    return {
      localPoint: new THREE.Vector3(
        eyeMid.x,
        y,
        args.faceLandmarks.frontZLocal ?? eyeMid.z,
      ),
      referenceSizeLocal: {
        width: Math.max(interocular * 0.55, faceWidth * 0.18),
        height: Math.max(interocular * 0.22, faceHeight * 0.08),
      },
      source: "fallback",
    };
  }

  private _bindTargetsFaceMesh(
    bind: MorphTargetBindLike,
    faceMesh: THREE.Mesh,
  ): boolean {
    return bind.primitives.some((primitive) => primitive === faceMesh);
  }

  private _createAnchorSnapshot(args: {
    anchor: "undereye" | "blush" | "mouth";
    side: AvatarVFXSide | null;
    source: AvatarFaceTextureAnchorSource;
    localSeedPoint: THREE.Vector3;
    referenceSizeLocal: AvatarFaceTextureReferenceSize;
    projection: FaceProjectionData;
  }): AvatarFaceTextureAnchorSnapshot | null {
    const projected = this._projectPointToFaceSurface(
      args.projection,
      args.localSeedPoint,
    );
    if (!projected) return null;
    const referenceSizeUv = this._projectReferenceSizeUv({
      projection: args.projection,
      localPoint: projected.localPoint,
      referenceSizeLocal: args.referenceSizeLocal,
    });

    return {
      anchor: args.anchor,
      side: args.side,
      source: args.source,
      localPoint: toVectorSnapshot(projected.localPoint),
      worldPoint: cloneWorldPoint(
        args.projection.anchorObject,
        projected.localPoint,
      ),
      uv: {
        u: projected.uv.x,
        v: projected.uv.y,
      },
      referenceSizeLocal: args.referenceSizeLocal,
      referenceSizeUv,
    };
  }

  private _createFlattenRegionSnapshot(args: {
    region: "sample" | "eye" | "mouth";
    side: AvatarVFXSide | null;
    source: AvatarFaceTextureAnchorSource;
    localSeedPoint: THREE.Vector3;
    referenceSizeLocal: AvatarFaceTextureReferenceSize;
    projection: FaceProjectionData;
  }): AvatarFaceTextureFlattenRegionSnapshot | null {
    const projected = this._projectPointToFaceSurface(
      args.projection,
      args.localSeedPoint,
    );
    if (!projected) return null;
    const referenceSizeUv = this._projectReferenceSizeUv({
      projection: args.projection,
      localPoint: projected.localPoint,
      referenceSizeLocal: args.referenceSizeLocal,
    });

    return {
      region: args.region,
      side: args.side,
      source: args.source,
      localPoint: toVectorSnapshot(projected.localPoint),
      worldPoint: cloneWorldPoint(
        args.projection.anchorObject,
        projected.localPoint,
      ),
      uv: {
        u: projected.uv.x,
        v: projected.uv.y,
      },
      referenceSizeLocal: args.referenceSizeLocal,
      referenceSizeUv,
    };
  }

  private _projectReferenceSizeUv(args: {
    projection: FaceProjectionData;
    localPoint: THREE.Vector3;
    referenceSizeLocal: AvatarFaceTextureReferenceSize;
  }): AvatarFaceTextureReferenceSize {
    const halfWidth = args.referenceSizeLocal.width * 0.5;
    const halfHeight = args.referenceSizeLocal.height * 0.5;
    const samples = [
      args.localPoint.clone(),
      args.localPoint.clone().add(new THREE.Vector3(-halfWidth, 0, 0)),
      args.localPoint.clone().add(new THREE.Vector3(halfWidth, 0, 0)),
      args.localPoint.clone().add(new THREE.Vector3(0, halfHeight, 0)),
      args.localPoint.clone().add(new THREE.Vector3(0, -halfHeight, 0)),
    ]
      .map((point) => this._projectPointToFaceSurface(args.projection, point))
      .filter((value): value is ProjectedUvPoint => value !== null);

    if (samples.length === 0) {
      return {
        width: 0.1,
        height: 0.1,
      };
    }

    const minU = Math.min(...samples.map((sample) => sample.uv.x));
    const maxU = Math.max(...samples.map((sample) => sample.uv.x));
    const minV = Math.min(...samples.map((sample) => sample.uv.y));
    const maxV = Math.max(...samples.map((sample) => sample.uv.y));

    return {
      width: clampMin(maxU - minU, 0.01),
      height: clampMin(maxV - minV, 0.01),
    };
  }

  private _projectPointToFaceSurface(
    projection: FaceProjectionData,
    localPoint: THREE.Vector3,
  ): ProjectedUvPoint | null {
    const triangle = new THREE.Triangle();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const closest = new THREE.Vector3();
    const barycoord = new THREE.Vector3();
    const uvA = new THREE.Vector2();
    const uvB = new THREE.Vector2();
    const uvC = new THREE.Vector2();
    const bestUv = new THREE.Vector2();
    const bestPoint = new THREE.Vector3();

    let found = false;
    let bestDistanceSq = Infinity;

    for (let offset = 0; offset + 2 < projection.count; offset += 3) {
      const first = projection.orderedVertexIndices[offset];
      const second = projection.orderedVertexIndices[offset + 1];
      const third = projection.orderedVertexIndices[offset + 2];
      const pointA = projection.pointsByIndex.get(first) ?? null;
      const pointB = projection.pointsByIndex.get(second) ?? null;
      const pointC = projection.pointsByIndex.get(third) ?? null;
      if (!pointA || !pointB || !pointC) continue;

      a.copy(pointA);
      b.copy(pointB);
      c.copy(pointC);
      triangle.set(a, b, c);
      triangle.closestPointToPoint(localPoint, closest);
      const distanceSq = closest.distanceToSquared(localPoint);
      if (distanceSq >= bestDistanceSq) {
        continue;
      }

      THREE.Triangle.getBarycoord(closest, a, b, c, barycoord);
      if (
        !Number.isFinite(barycoord.x) ||
        !Number.isFinite(barycoord.y) ||
        !Number.isFinite(barycoord.z)
      ) {
        continue;
      }

      uvA.fromBufferAttribute(projection.uv, first);
      uvB.fromBufferAttribute(projection.uv, second);
      uvC.fromBufferAttribute(projection.uv, third);

      bestUv.set(
        uvA.x * barycoord.x + uvB.x * barycoord.y + uvC.x * barycoord.z,
        uvA.y * barycoord.x + uvB.y * barycoord.y + uvC.y * barycoord.z,
      );
      bestPoint.copy(closest);
      bestDistanceSq = distanceSq;
      found = true;
    }

    if (!found) {
      return null;
    }

    return {
      localPoint: bestPoint,
      uv: bestUv,
    };
  }
}
