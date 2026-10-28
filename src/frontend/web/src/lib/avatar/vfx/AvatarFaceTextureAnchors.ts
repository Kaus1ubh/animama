import * as THREE from "three";

import type { Avatar } from "../Avatar";
import { addAvatarIssue, type AvatarIssue } from "../diagnostics/issues";
import type {
  AvatarFaceTextureAnchorSnapshot,
  AvatarFaceTextureAnchorsSnapshot,
  AvatarFaceTextureAnchorSource,
  AvatarFaceTextureFlattenRegionSnapshot,
  AvatarFaceTextureReferenceSize,
  AvatarFaceTextureUvCoordinate,
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
  onlyTriangles,
  type CollectedPrimitiveData,
  type RuntimePrimitiveBindingEntry,
} from "./avatarPrimitiveUtils";
import { resolveFrontAxisSign } from "./AvatarFaceLandmarks";
import { FaceCover, type FaceCoverTriangle } from "./faceCover";
import { findFaceIslandTriangles } from "./faceIsland";
import {
  findFaceSkinRegion,
  hasEyeDetailGeometry,
  measureEyelidBounds,
  resolveAvatarFacePartEntries,
  selectFacePartEntries,
} from "./faceParts";
import {
  baseTextureOf,
  TextureUvMapping,
  type UvPoint,
} from "./textureUvMapping";
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
/** Room around the eyelid a lid-sized cleanup region keeps. */
const FLATTEN_LID_MARGIN = 1.15;
const FLATTEN_MOUTH_WIDTH_RATIO = 1.35;
const FLATTEN_MOUTH_HEIGHT_RATIO = 1.7;
const FLATTEN_SAMPLE_WIDTH_RATIO = 0.2;
const FLATTEN_SAMPLE_HEIGHT_RATIO = 0.14;
/**
 * A covered under-eye or cheek anchor moves down in steps of this share of
 * the distance between the eyes, at most {@link UNCOVER_MAX_DROP_RATIO} of it.
 */
const UNCOVER_STEP_RATIO = 0.01;
const UNCOVER_MAX_DROP_RATIO = 0.5;
/**
 * How near (a share of the eye spacing) the island triangles a lowered anchor
 * is projected onto must lie to its path; a projection farther away than
 * this is redone over the whole island, so results match it exactly.
 */
const UNCOVER_SEARCH_RADIUS_RATIO = 0.25;

/**
 * The cover anchors are checked against while being built, and which anchors
 * it moved down or left covered (for the load log).
 */
type AnchorCoverage = {
  cover: FaceCover | null;
  lowered: string[];
  covered: string[];
};

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
  /** Every triangle of the face primitive, the island's and the others'. */
  primitive: CollectedPrimitiveData;
  faceBounds: THREE.Box3;
  /** Where the face's UVs land on its texture's image. */
  mapping: TextureUvMapping;
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
  issues: AvatarIssue[] = [],
): AvatarFaceTextureAnchorsSnapshot {
  return {
    status: "unavailable",
    warnings,
    issues,
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

/** A face UV as the position on the face texture's image where art lands. */
function toImageCoordinate(
  mapping: TextureUvMapping,
  uv: UvPoint,
): AvatarFaceTextureUvCoordinate {
  const point = mapping.toImage(uv);
  return { u: point.x, v: point.y };
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

/**
 * Whether a material lets what lies behind show: blended or cut out, by
 * three's `transparent` or `alphaTest`, or a three-liltoon render mode other
 * than opaque (its cut-out mode need not set `alphaTest`).
 */
function isSeeThrough(material: THREE.Material): boolean {
  const lilToon = material as {
    isLilToonMaterial?: boolean;
    renderMode?: unknown;
  };
  if (
    lilToon.isLilToonMaterial &&
    typeof lilToon.renderMode === "string" &&
    lilToon.renderMode !== "opaque"
  ) {
    return true;
  }
  return material.transparent || material.alphaTest > 0;
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

/**
 * The bounds of a face's island points, clipped to its face bounds (an
 * island that fell back to every triangle of a primitive that also holds the
 * body stays within the face). Null when nothing is left.
 */
function measureFaceExtent(projection: FaceProjectionData): THREE.Box3 | null {
  const island = new THREE.Box3();
  for (const vertex of projection.uniqueVertexIndices) {
    const point = projection.pointsByIndex.get(vertex);
    if (point) island.expandByPoint(point);
  }
  island.intersect(projection.faceBounds);
  return island.isEmpty() ? null : island;
}

/** Where an eye's under-eye anchor is seeded: just below the eye. */
function underEyeSeedY(eye: AvatarFaceEyeLandmarkSnapshot): number {
  return (
    eye.boundsLocal.min.y - eye.boundsLocal.size.y * UNDER_EYE_Y_OFFSET_RATIO
  );
}

/**
 * How far below its seed an under-eye anchor that `lowered` moved out from
 * under a cover lies; 0 when it was not lowered.
 */
function loweredBy(
  eye: AvatarFaceEyeLandmarkSnapshot | null,
  anchor: AvatarFaceTextureAnchorSnapshot | null,
  lowered: boolean,
): number {
  if (!lowered || !eye || !anchor) return 0;
  return Math.max(0, underEyeSeedY(eye) - anchor.localPoint.y);
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

/**
 * The triangles (three vertex indices each, of `primitiveData`'s order) of a
 * face skin primitive's own UV island, found by the face landmarks' eyes
 * (`findFaceIslandTriangles`, with the islands outside its outline when
 * `withOuterIslands`; between the eyes on the face front as the seed); every
 * triangle without both eyes or such an island. Texture anchors project onto
 * the island, and whole-face art is clipped to it with its outer islands.
 */
export function selectFaceIsland(args: {
  primitiveData: CollectedPrimitiveData;
  position: THREE.BufferAttribute;
  uv: THREE.BufferAttribute;
  landmarks: AvatarFaceLandmarksSnapshot;
  withOuterIslands?: boolean;
}): number[] {
  const ordered = args.primitiveData.orderedVertexIndices;
  const eyeMid = resolveEyeMidpoint(args.landmarks);
  const { left, right } = args.landmarks.eyes;
  if (!eyeMid || !left || !right) return ordered;
  const keep = findFaceIslandTriangles({
    corners: ordered,
    pointOf: (vertex) => args.primitiveData.pointsByIndex.get(vertex),
    position: args.position,
    uv: args.uv,
    seed: eyeMid,
    eyes: [toVector3(left.centerLocal), toVector3(right.centerLocal)],
    ...(args.withOuterIslands ? { withIslands: "outer" as const } : {}),
  });
  if (!keep) return ordered;
  const triangles: number[] = [];
  keep.forEach((kept, at) => {
    if (kept) triangles.push(...ordered.slice(at * 3, at * 3 + 3));
  });
  return triangles;
}

export class AvatarFaceTextureAnchors {
  private readonly _avatar: Avatar;
  private _snapshot: AvatarFaceTextureAnchorsSnapshot = createEmptySnapshot();
  private _warnings: string[] = [];
  private _issues: AvatarIssue[] = [];
  private _faceExtent: THREE.Box3 | null = null;

  constructor(avatar: Avatar) {
    this._avatar = avatar;
    this._build();
  }

  getSnapshot(): AvatarFaceTextureAnchorsSnapshot {
    return this._snapshot;
  }

  /**
   * The face itself, in the face landmarks' head space: the bounds of the
   * face's UV island (the triangles anchors project onto) within the face
   * bounds, so ears, a hat or hood and hair in the face mesh are left out.
   * The Avatar's size-aware placement measures the face by it. Null until
   * built or without a face.
   */
  getFaceExtent(): THREE.Box3 | null {
    return this._faceExtent?.clone() ?? null;
  }

  dispose(): void {
    this._warnings = [];
    this._issues = [];
    this._snapshot = createEmptySnapshot();
    this._faceExtent = null;
  }

  /** Record a finding as dev-panel text and as a stable code. */
  private _warn(issue: AvatarIssue, message: string): void {
    this._warnings.push(message);
    addAvatarIssue(this._issues, issue);
  }

  /** Stop building: the snapshot holds only the findings so far. */
  private _unavailable(): void {
    this._snapshot = createEmptySnapshot(
      [...this._warnings],
      [...this._issues],
    );
  }

  private _build(): void {
    const faceLandmarks = this._avatar.faceLandmarks?.getSnapshot() ?? null;
    const anchorObject = this._avatar.faceLandmarks?.getAnchorObject() ?? null;
    if (!faceLandmarks || faceLandmarks.status !== "ready" || !anchorObject) {
      this._warn(
        { code: "anchors_landmarks_unavailable" },
        "Face landmarks are unavailable for texture anchors.",
      );
      this._unavailable();
      return;
    }

    const runtimeResult = buildRuntimePrimitiveBindings(this._avatar);
    for (const warning of runtimeResult.warnings) {
      this._warn({ code: "scene_bindings_unavailable" }, warning);
    }
    const faces = resolveAvatarFacePartEntries(
      this._avatar,
      runtimeResult.entries,
    ).faces;
    if (faces.length === 0) {
      this._warn(
        { code: "anchors_face_skin_missing" },
        "No face skin part was detected on this avatar.",
      );
      this._unavailable();
      return;
    }

    const { binding: faceBinding, projection } = this._selectFaceProjection(
      faces,
      anchorObject,
      faceLandmarks,
    );
    if (!faceBinding || !projection) {
      this._warn(
        { code: "anchors_projection_failed" },
        "Unable to prepare face texture anchor projection data.",
      );
      this._unavailable();
      return;
    }

    this._faceExtent = measureFaceExtent(projection);

    const coverage: AnchorCoverage = {
      cover: this._buildFaceCover({
        projection,
        faceLandmarks,
        entries: runtimeResult.entries,
      }),
      lowered: [],
      covered: [],
    };

    // No line or lash geometry: they are likely painted into the face
    // texture, so eye cleanup covers each eyelid blink moves.
    const map = this._avatar.facePartMap;
    const lids =
      map && this._avatar.vrm && !hasEyeDetailGeometry(map)
        ? measureEyelidBounds(
            this._avatar.vrm,
            faceBinding.object,
            anchorObject,
          )
        : null;

    const mouth = this._resolveMouthAnchor({
      projection,
      faceLandmarks,
    });
    if (!mouth) {
      this._warn(
        { code: "anchors_mouth_missing" },
        "Unable to resolve a mouth texture anchor.",
      );
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

    const underEye = {
      left: this._resolveUnderEyeAnchor({
        side: "left",
        eye: faceLandmarks.eyes.left,
        projection,
        coverage,
      }),
      right: this._resolveUnderEyeAnchor({
        side: "right",
        eye: faceLandmarks.eyes.right,
        projection,
        coverage,
      }),
    };
    const blushOn = (side: AvatarVFXSide) =>
      this._resolveBlushAnchor({
        side,
        eye: faceLandmarks.eyes[side],
        mouth,
        projection,
        coverage,
        drop: loweredBy(
          faceLandmarks.eyes[side],
          underEye[side],
          coverage.lowered.includes(`undereye.${side}`),
        ),
      });

    const snapshot: AvatarFaceTextureAnchorsSnapshot = {
      status: "ready",
      warnings: [...this._warnings],
      issues: [...this._issues],
      faceBindingKey: faceBinding.bindingKey,
      faceMaterialName: faceBinding.materialName,
      anchors: {
        undereye: underEye,
        blush: { left: blushOn("left"), right: blushOn("right") },
        mouth: {
          center: mouth
            ? this._createAnchorSnapshot({
                anchor: "mouth",
                side: null,
                source: mouth.source,
                uncover: "mark",
                localSeedPoint: mouth.localPoint,
                referenceSizeLocal: mouth.referenceSizeLocal,
                projection,
                coverage,
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
            lid: lids?.left ?? null,
            projection,
          }),
          right: this._resolveFlattenEyeRegion({
            side: "right",
            eye: faceLandmarks.eyes.right,
            lid: lids?.right ?? null,
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
      lowered: coverage.lowered,
      covered: coverage.covered,
      warnings: snapshot.warnings,
    });
  }

  /**
   * The face primitive anchors project onto. Several share the face texture;
   * the anchors belong on the one nearest the eyes.
   */
  private _selectFaceProjection(
    faces: readonly RuntimePrimitiveBindingEntry[],
    anchorObject: THREE.Object3D,
    faceLandmarks: AvatarFaceLandmarksSnapshot,
  ): {
    binding: RuntimePrimitiveBindingEntry | null;
    projection: FaceProjectionData | null;
  } {
    const eyeMid = resolveEyeMidpoint(faceLandmarks);
    let best: {
      binding: RuntimePrimitiveBindingEntry;
      projection: FaceProjectionData;
      distance: number;
    } | null = null;
    for (const binding of faces) {
      const projection = this._prepareFaceProjectionData({
        binding,
        anchorObject,
        faceLandmarks,
      });
      if (!projection) continue;
      if (faces.length === 1 || !eyeMid) return { binding, projection };
      const projected = this._projectPointToFaceSurface(projection, eyeMid);
      const distance = projected
        ? projected.localPoint.distanceTo(eyeMid)
        : Infinity;
      if (!best || distance < best.distance) {
        best = { binding, projection, distance };
      }
    }
    return best ?? { binding: null, projection: null };
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
    const collected = collectPrimitiveData({
      avatar: this._avatar,
      binding: args.binding,
      anchorObject: args.anchorObject,
    });
    if (!collected) return null;
    // The face of a primitive that also holds the body is its head region.
    const region = findFaceSkinRegion(
      this._avatar.facePartMap,
      args.binding.bindingKey,
    );
    const primitiveData = region
      ? onlyTriangles(collected, new Set(region.triangles))
      : collected;
    if (primitiveData.orderedVertexIndices.length === 0) {
      return null;
    }
    const position = geometry.getAttribute("position");
    if (!(position instanceof THREE.BufferAttribute) || position.itemSize < 3) {
      return null;
    }

    const index = geometry.getIndex();
    const faceBounds = args.faceLandmarks.faceBoundsLocal
      ? toBox3(args.faceLandmarks.faceBoundsLocal)
      : computeBoundsFromPoints(primitiveData.orderedPoints);
    if (!faceBounds) {
      return null;
    }
    const orderedVertexIndices = selectFaceIsland({
      primitiveData,
      position,
      uv,
      landmarks: args.faceLandmarks,
    });

    return {
      bindingKey: args.binding.bindingKey,
      materialName: args.binding.materialName,
      anchorObject: args.anchorObject,
      meshObject: args.binding.object,
      position,
      uv,
      index,
      start: 0,
      count: orderedVertexIndices.length,
      orderedVertexIndices,
      pointsByIndex: primitiveData.pointsByIndex,
      uniqueVertexIndices: Array.from(new Set(orderedVertexIndices)),
      primitive: collected,
      faceBounds,
      mapping: TextureUvMapping.of(baseTextureOf(args.binding.object)),
    };
  }

  private _resolveUnderEyeAnchor(args: {
    side: AvatarVFXSide;
    eye: AvatarFaceEyeLandmarkSnapshot | null;
    projection: FaceProjectionData;
    coverage: AnchorCoverage;
  }): AvatarFaceTextureAnchorSnapshot | null {
    const { eye, side, projection, coverage } = args;
    if (!eye) return null;
    const localSeedPoint = toVector3(eye.centerLocal);
    localSeedPoint.y = underEyeSeedY(eye);
    return this._createAnchorSnapshot({
      anchor: "undereye",
      side,
      source: "geometric",
      uncover: "lower",
      localSeedPoint,
      referenceSizeLocal: {
        width: clampMin(eye.boundsLocal.size.x * UNDER_EYE_WIDTH_RATIO, 0.02),
        height: clampMin(eye.boundsLocal.size.y * UNDER_EYE_HEIGHT_RATIO, 0.02),
      },
      projection,
      coverage,
    });
  }

  private _resolveBlushAnchor(args: {
    side: AvatarVFXSide;
    eye: AvatarFaceEyeLandmarkSnapshot | null;
    mouth: MouthAnchorCandidate | null;
    projection: FaceProjectionData;
    coverage: AnchorCoverage;
    /**
     * How far the under-eye anchor on this side moved down out from under a
     * cover; the cheek's seed moves down as far, so the two stay apart
     * instead of both landing on the first uncovered spot.
     */
    drop: number;
  }): AvatarFaceTextureAnchorSnapshot | null {
    const { eye, mouth, projection, side, coverage } = args;
    if (!eye || !mouth) return null;
    const eyePoint = toVector3(eye.centerLocal);

    const lowerEyeY =
      eye.boundsLocal.min.y - eye.boundsLocal.size.y * BLUSH_Y_OFFSET_RATIO;
    const localSeedPoint = new THREE.Vector3(
      eyePoint.x,
      THREE.MathUtils.lerp(lowerEyeY, mouth.localPoint.y, BLUSH_MOUTH_Y_LERP) -
        args.drop,
      eyePoint.z,
    );

    return this._createAnchorSnapshot({
      anchor: "blush",
      side,
      source: "geometric",
      uncover: "lower",
      localSeedPoint,
      referenceSizeLocal: {
        width: clampMin(eye.boundsLocal.size.x * BLUSH_WIDTH_RATIO, 0.03),
        height: clampMin(eye.boundsLocal.size.y * BLUSH_HEIGHT_RATIO, 0.03),
      },
      projection,
      coverage,
    });
  }

  /**
   * The face-cleanup region around an eye. With `lid` (lashes painted into
   * the face texture) it grows to cover the eyelid blink moves, without the
   * upward nudge the eye-sized region takes.
   */
  private _resolveFlattenEyeRegion(args: {
    side: AvatarVFXSide;
    eye: AvatarFaceEyeLandmarkSnapshot | null;
    lid: THREE.Box3 | null;
    projection: FaceProjectionData;
  }): AvatarFaceTextureFlattenRegionSnapshot | null {
    const { eye, projection, side } = args;
    if (!eye) return null;
    let referenceSizeLocal = {
      width: clampMin(eye.boundsLocal.size.x * FLATTEN_EYE_WIDTH_RATIO, 0.03),
      height: clampMin(eye.boundsLocal.size.y * FLATTEN_EYE_HEIGHT_RATIO, 0.03),
    };
    const baseSeedPoint = toVector3(eye.centerLocal);
    let yOffsetRatio = FLATTEN_EYE_Y_OFFSET_RATIO;
    if (args.lid) {
      const covered = new THREE.Box3()
        .setFromCenterAndSize(
          baseSeedPoint,
          new THREE.Vector3(
            referenceSizeLocal.width,
            referenceSizeLocal.height,
            0,
          ),
        )
        .union(args.lid);
      const size = covered.getSize(new THREE.Vector3());
      const center = covered.getCenter(new THREE.Vector3());
      referenceSizeLocal = {
        width: size.x * FLATTEN_LID_MARGIN,
        height: size.y * FLATTEN_LID_MARGIN,
      };
      baseSeedPoint.set(center.x, center.y, baseSeedPoint.z);
      yOffsetRatio = 0;
    }
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
    const centre = projection.mapping.toImage(baseProjected.uv);
    const offsetUvV = THREE.MathUtils.clamp(
      centre.y + referenceSizeUv.height * yOffsetRatio,
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
        u: centre.x,
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

  /**
   * A decal anchor: `localSeedPoint` projected onto the face's island. Where
   * a surface covers that point (`coverage.cover`: eyes or a nose modelled
   * over the skin), `uncover: "lower"` moves the anchor down until art there
   * shows ({@link _lowerUncovered}), and an anchor still covered is marked
   * `covered`, so painted art skips it. With `uncover: "mark"` (the mouth,
   * whose art reaches past a nose over its centre) it is marked only when
   * its sides are covered too. Moved and covered anchors are noted in
   * `coverage`.
   */
  private _createAnchorSnapshot(args: {
    anchor: "undereye" | "blush" | "mouth";
    side: AvatarVFXSide | null;
    source: AvatarFaceTextureAnchorSource;
    uncover: "lower" | "mark";
    localSeedPoint: THREE.Vector3;
    referenceSizeLocal: AvatarFaceTextureReferenceSize;
    projection: FaceProjectionData;
    coverage: AnchorCoverage;
  }): AvatarFaceTextureAnchorSnapshot | null {
    const seedProjected = this._projectPointToFaceSurface(
      args.projection,
      args.localSeedPoint,
    );
    if (!seedProjected) return null;
    let projected = seedProjected;
    const { cover } = args.coverage;
    let covered = cover?.covers(projected.localPoint) ?? false;
    if (cover && covered && args.uncover === "mark") {
      const centre = seedProjected.localPoint;
      const halfWidth = args.referenceSizeLocal.width / 2;
      covered = [-halfWidth, halfWidth].every((dx) => {
        const side = this._projectPointToFaceSurface(
          args.projection,
          centre.clone().setX(centre.x + dx),
        );
        return side !== null && cover.covers(side.localPoint);
      });
    }
    const name = args.side ? `${args.anchor}.${args.side}` : args.anchor;
    if (cover && covered && args.uncover === "lower") {
      const lowered = this._lowerUncovered({
        projection: args.projection,
        seed: args.localSeedPoint,
        clearance: args.referenceSizeLocal.height / 2,
        cover,
      });
      if (lowered) {
        projected = lowered;
        covered = false;
        args.coverage.lowered.push(name);
      }
    }
    if (covered) args.coverage.covered.push(name);
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
      uv: toImageCoordinate(args.projection.mapping, projected.uv),
      referenceSizeLocal: args.referenceSizeLocal,
      referenceSizeUv,
      ...(covered ? { covered: true as const } : {}),
    };
  }

  /**
   * The first point on the face below `seed`, in steps of
   * {@link UNCOVER_STEP_RATIO} of the eye spacing, that nothing covers, then
   * lowered by `clearance` more where that stays uncovered, so the art's top
   * clears the cover too; null when no step within
   * {@link UNCOVER_MAX_DROP_RATIO} of the eye spacing is uncovered. Under-eye
   * and cheek art belongs below eyes modelled larger than their estimate (eye
   * dots, a low-poly eye shape).
   *
   * Each step projects onto the island triangles near the seed's path and
   * tests the cover triangles there, read once, so the search costs about one
   * projection over the island however many steps it takes. A step whose
   * nearest point lies farther than the search radius is projected over the
   * whole island, and a point outside the path is tested against the whole
   * cover, so each step gives the result a full projection and test would.
   */
  private _lowerUncovered(args: {
    projection: FaceProjectionData;
    seed: THREE.Vector3;
    clearance: number;
    cover: FaceCover;
  }): ProjectedUvPoint | null {
    const { projection, seed } = args;
    const spacing = args.cover.eyeSpacing;
    if (spacing <= EPSILON) return null;
    const step = spacing * UNCOVER_STEP_RATIO;
    const maxDrop = spacing * UNCOVER_MAX_DROP_RATIO;
    const radius = spacing * UNCOVER_SEARCH_RADIUS_RATIO;
    const path = {
      minX: seed.x - radius,
      maxX: seed.x + radius,
      minY: seed.y - maxDrop - args.clearance - radius,
      maxY: seed.y + radius,
    };
    const near = this._islandTrianglesWithin(projection, path);
    const nearCover = args.cover.within(path);
    // Every cover triangle over a point inside the path meets the path.
    const covered = (point: THREE.Vector3) =>
      (point.x >= path.minX &&
      point.x <= path.maxX &&
      point.y >= path.minY &&
      point.y <= path.maxY
        ? nearCover
        : args.cover
      ).covers(point);
    const lowered = (drop: number) => {
      const target = seed.clone().setY(seed.y - drop);
      const found = this._projectPointToFaceSurface(projection, target, near);
      return found && found.localPoint.distanceTo(target) <= radius
        ? found
        : this._projectPointToFaceSurface(projection, target);
    };
    for (let drop = step; drop <= maxDrop + EPSILON; drop += step) {
      const point = lowered(drop);
      if (!point || covered(point.localPoint)) continue;
      const clear = lowered(drop + args.clearance);
      return clear && !covered(clear.localPoint) ? clear : point;
    }
    return null;
  }

  /**
   * The island triangles (offsets into `orderedVertexIndices`) whose outline
   * in the front view meets `box`.
   */
  private _islandTrianglesWithin(
    projection: FaceProjectionData,
    box: { minX: number; maxX: number; minY: number; maxY: number },
  ): number[] {
    const offsets: number[] = [];
    const corners = projection.orderedVertexIndices;
    for (let offset = 0; offset + 2 < projection.count; offset += 3) {
      const points = [0, 1, 2].map((corner) =>
        projection.pointsByIndex.get(corners[offset + corner]!),
      );
      if (points.some((point) => !point)) continue;
      const xs = points.map((point) => point!.x);
      const ys = points.map((point) => point!.y);
      if (
        Math.max(...xs) >= box.minX &&
        Math.min(...xs) <= box.maxX &&
        Math.max(...ys) >= box.minY &&
        Math.min(...ys) <= box.maxY
      ) {
        offsets.push(offset);
      }
    }
    return offsets;
  }

  /**
   * What may cover art painted on the face ({@link FaceCover}): the face
   * primitive's triangles outside the face's own island (eyes, dots or a
   * nose kept in the face mesh) and the iris, white and highlight mesh parts.
   * Eye-line and lash parts are left out: their strands are usually cut out
   * of a texture, so art between them shows. Eye-line and lash regions of the
   * face primitive count only when the face material is opaque, where the
   * region is solid geometry (painted-on eye shapes that blink moves). Null
   * without both eyes, whose spacing scales it.
   */
  private _buildFaceCover(args: {
    projection: FaceProjectionData;
    faceLandmarks: AvatarFaceLandmarksSnapshot;
    entries: readonly RuntimePrimitiveBindingEntry[];
  }): FaceCover | null {
    const { projection, faceLandmarks } = args;
    const eyeSpacing = resolveInterocularDistance(faceLandmarks);
    if (!eyeSpacing || faceLandmarks.frontZLocal === null) return null;
    const key = (corners: readonly number[], at: number) =>
      `${corners[at]},${corners[at + 1]},${corners[at + 2]}`;
    const island = new Set<string>();
    for (let at = 0; at + 2 < projection.count; at += 3) {
      island.add(key(projection.orderedVertexIndices, at));
    }
    const map = this._avatar.facePartMap;
    const faceMaterial = [projection.meshObject.material].flat()[0];
    const strands =
      faceMaterial && isSeeThrough(faceMaterial)
        ? new Set(
            (["eyeline", "eyelash"] as const).flatMap((role) =>
              (map?.parts[role].regions ?? [])
                .filter((region) => region.bindingKey === projection.bindingKey)
                .flatMap((region) => region.triangles),
            ),
          )
        : null;
    const triangles: FaceCoverTriangle[] = [];
    const addTriangles = (
      data: CollectedPrimitiveData,
      skip: (at: number) => boolean,
    ) => {
      const corners = data.orderedVertexIndices;
      for (let at = 0; at + 2 < corners.length; at += 3) {
        if (skip(at)) continue;
        const a = data.pointsByIndex.get(corners[at]!);
        const b = data.pointsByIndex.get(corners[at + 1]!);
        const c = data.pointsByIndex.get(corners[at + 2]!);
        if (a && b && c) triangles.push([a, b, c]);
      }
    };
    const face = projection.primitive;
    addTriangles(
      face,
      (at) =>
        island.has(key(face.orderedVertexIndices, at)) ||
        (strands?.has(face.firstTriangle + at / 3) ?? false),
    );
    const whites = new Set(map?.eyeWhite ?? []);
    const eyeLayers = new Set([
      ...selectFacePartEntries(
        map,
        ["eye_left", "eye_right", "eye_highlight"],
        args.entries,
      ),
      ...args.entries.filter((entry) => whites.has(entry.bindingKey)),
    ]);
    for (const entry of eyeLayers) {
      if (entry.bindingKey === projection.bindingKey) continue;
      const data = collectPrimitiveData({
        avatar: this._avatar,
        binding: entry,
        anchorObject: projection.anchorObject,
      });
      if (data) addTriangles(data, () => false);
    }
    return new FaceCover({
      triangles,
      frontSign: resolveFrontAxisSign({
        faceBounds: projection.faceBounds,
        frontZLocal: faceLandmarks.frontZLocal,
      }),
      eyeSpacing,
      near: {
        minX: projection.faceBounds.min.x,
        maxX: projection.faceBounds.max.x,
        minY: projection.faceBounds.min.y,
        maxY: projection.faceBounds.max.y,
      },
    });
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
      uv: toImageCoordinate(args.projection.mapping, projected.uv),
      referenceSizeLocal: args.referenceSizeLocal,
      referenceSizeUv,
    };
  }

  /**
   * The extent on the face texture's image of a `referenceSizeLocal` box
   * around `localPoint`: its centre and edge midpoints projected onto the
   * face, mapped onto the image together.
   */
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

    // Wrapped by the first sample's tile, so the box stays whole.
    const points = samples.map((sample) =>
      args.projection.mapping.toImage(sample.uv, samples[0]!.uv),
    );
    const minU = Math.min(...points.map((point) => point.x));
    const maxU = Math.max(...points.map((point) => point.x));
    const minV = Math.min(...points.map((point) => point.y));
    const maxV = Math.max(...points.map((point) => point.y));

    return {
      width: clampMin(maxU - minU, 0.01),
      height: clampMin(maxV - minV, 0.01),
    };
  }

  /**
   * The point of the face island nearest `localPoint`, with its UV; over the
   * island triangles at `offsets` (into `orderedVertexIndices`) when given.
   */
  private _projectPointToFaceSurface(
    projection: FaceProjectionData,
    localPoint: THREE.Vector3,
    offsets?: readonly number[],
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

    const total = offsets ? offsets.length : projection.count / 3;
    for (let at = 0; at < total; at += 1) {
      const offset = offsets ? offsets[at]! : at * 3;
      if (offset + 2 >= projection.count) continue;
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
