export type AvatarPortraitPoint3 = {
  x: number;
  y: number;
  z: number;
};

export type AvatarPortraitLandmark = AvatarPortraitPoint3 & {
  visible?: boolean;
};

export type AvatarPortraitFraming = {
  cameraPosition: AvatarPortraitPoint3;
  target: AvatarPortraitPoint3;
  distance: number;
  faceSpan: number | null;
  usedLandmarkCount: number;
};

export type ResolveAvatarPortraitFramingInput = {
  head: AvatarPortraitPoint3;
  landmarks?: readonly AvatarPortraitLandmark[];
  fovDegrees?: number;
  targetFaceFill?: number;
  fallbackDistance?: number;
  minDistance?: number;
  maxDistance?: number;
  headTopY?: number;
};

const DEFAULT_FOV_DEGREES = 35;
const DEFAULT_TARGET_FACE_FILL = 0.82;
const DEFAULT_FALLBACK_DISTANCE = 0.52;
const DEFAULT_MIN_DISTANCE = 0.42;
const DEFAULT_MAX_DISTANCE = 2.4;

function isFinitePoint(point: AvatarPortraitPoint3): boolean {
  return [point.x, point.y, point.z].every(Number.isFinite);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Resolve deterministic head-relative framing from optional face landmarks.
 * Invisible or invalid landmarks are ignored, leaving the normalized head bone
 * as a bounded fallback for unusual but valid VRMs.
 */
export function resolveAvatarPortraitFraming(
  input: ResolveAvatarPortraitFramingInput,
): AvatarPortraitFraming {
  if (!isFinitePoint(input.head)) {
    throw new Error("avatar_portrait_invalid_head_position");
  }

  const minDistance = Math.max(0.01, input.minDistance ?? DEFAULT_MIN_DISTANCE);
  const maxDistance = Math.max(
    minDistance,
    input.maxDistance ?? DEFAULT_MAX_DISTANCE,
  );
  const fallbackDistance = clamp(
    input.fallbackDistance ?? DEFAULT_FALLBACK_DISTANCE,
    minDistance,
    maxDistance,
  );
  const fovDegrees = clamp(input.fovDegrees ?? DEFAULT_FOV_DEGREES, 10, 90);
  const targetFaceFill = clamp(
    input.targetFaceFill ?? DEFAULT_TARGET_FACE_FILL,
    0.4,
    0.85,
  );
  const landmarks = (input.landmarks ?? []).filter(
    (point) => point.visible !== false && isFinitePoint(point),
  );
  const headTopY =
    typeof input.headTopY === "number" && Number.isFinite(input.headTopY)
      ? input.headTopY
      : null;
  const headTopOffset =
    headTopY !== null ? clamp((headTopY - input.head.y) * 0.35, 0, 0.3) : 0;
  const halfFovRadians = (fovDegrees * Math.PI) / 360;
  const fallbackTarget = {
    ...input.head,
    y: input.head.y + headTopOffset,
  };
  const accessoryDistance =
    headTopY !== null
      ? Math.min(
          Math.max(0, headTopY - fallbackTarget.y) /
            (Math.tan(halfFovRadians) * 0.92),
          fallbackDistance * 1.5,
        )
      : 0;
  const framedFallbackDistance = clamp(
    Math.max(fallbackDistance, accessoryDistance),
    minDistance,
    maxDistance,
  );

  if (landmarks.length < 2) {
    return {
      cameraPosition: {
        x: fallbackTarget.x,
        y: fallbackTarget.y,
        z: fallbackTarget.z + framedFallbackDistance,
      },
      target: fallbackTarget,
      distance: framedFallbackDistance,
      faceSpan: null,
      usedLandmarkCount: landmarks.length,
    };
  }

  const xs = landmarks.map((point) => point.x);
  const ys = landmarks.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const landmarkWidth = maxX - minX;
  const landmarkHeight = maxY - minY;

  // Eye and mouth landmarks cover only the inner face. Expand enough to keep
  // the head silhouette while making the face/head dominate compact UI rows.
  const faceSpan = Math.max(landmarkWidth * 1.8, landmarkHeight * 2.6);
  if (!Number.isFinite(faceSpan) || faceSpan <= 1e-4) {
    return {
      cameraPosition: {
        x: input.head.x,
        y: input.head.y,
        z: input.head.z + fallbackDistance,
      },
      target: { ...input.head },
      distance: fallbackDistance,
      faceSpan: null,
      usedLandmarkCount: landmarks.length,
    };
  }

  const distance = clamp(
    Math.max(
      faceSpan / (2 * Math.tan(halfFovRadians) * targetFaceFill),
      framedFallbackDistance,
    ),
    minDistance,
    maxDistance,
  );
  const faceCenterX = (minX + maxX) / 2;
  const faceCenterY = (minY + maxY) / 2;
  const target = {
    // Detector landmarks refine the normalized head target but never replace
    // it. A bad material/mesh match must not drag the portrait toward a torso
    // accessory or hair island.
    x:
      fallbackTarget.x +
      clamp((faceCenterX - fallbackTarget.x) * 0.25, -0.04, 0.04),
    y:
      fallbackTarget.y +
      clamp((faceCenterY - fallbackTarget.y) * 0.25, -0.04, 0.04),
    z: input.head.z,
  };

  return {
    cameraPosition: {
      x: target.x,
      y: target.y,
      z: target.z + distance,
    },
    target,
    distance,
    faceSpan,
    usedLandmarkCount: landmarks.length,
  };
}
