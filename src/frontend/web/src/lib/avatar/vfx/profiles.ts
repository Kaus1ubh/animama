import type { AvatarFaceLandmarksSnapshot } from "./landmark-types";
import type { AvatarVFXModelProfile, AvatarVFXNormalizedRect } from "./types";

type EyeLayout = NonNullable<AvatarVFXModelProfile["eyeLayout"]>;

const DEFAULT_LEFT_EYE_RECT: AvatarVFXNormalizedRect = {
  x: 0,
  y: 0,
  width: 0.5,
  height: 1,
};

const DEFAULT_RIGHT_EYE_RECT: AvatarVFXNormalizedRect = {
  x: 0.5,
  y: 0,
  width: 0.5,
  height: 1,
};

const DEFAULT_FACE_RECT: AvatarVFXNormalizedRect = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

export const DEFAULT_AVATAR_VFX_MODEL_PROFILE: AvatarVFXModelProfile = {
  eyeHighlightMaterialPatterns: [
    /eye.?highlight/i,
    /highlight.*eye/i,
    /eye.*highlight/i,
  ],
  eyelineMaterialPatterns: [/eyeline/i, /eye.?line/i, /line.*eye/i],
  eyelashMaterialPatterns: [/eyelash/i, /eye.?lash/i, /lash.*eye/i],
  eyeMaterialPatterns: [/iris/i],
  faceMaterialPatterns: [/face.*skin/i, /skin.*face/i, /\bface\b/i],
  eyeLayout: {
    left: DEFAULT_LEFT_EYE_RECT,
    right: DEFAULT_RIGHT_EYE_RECT,
    mirrorRight: true,
  },
  faceLayout: {
    rect: DEFAULT_FACE_RECT,
  },
};

export const AVATAR_VFX_MODEL_PROFILES: AvatarVFXModelProfile[] = [];

function includesValue(patterns: string[] | undefined, value: string | null) {
  if (!value || !patterns || patterns.length === 0) return false;
  return patterns.includes(value);
}

export function resolveAvatarVFXModelProfile(args: {
  sourceKey?: string | null;
  sourceUrl?: string | null;
}): AvatarVFXModelProfile {
  const sourceKey = args.sourceKey?.trim() || null;
  const sourceUrl = args.sourceUrl?.trim() || null;

  const match =
    AVATAR_VFX_MODEL_PROFILES.find((profile) => {
      if (includesValue(profile.sourceKeys, sourceKey)) return true;
      if (includesValue(profile.sourceUrls, sourceUrl)) return true;
      return false;
    }) ?? null;

  return {
    ...DEFAULT_AVATAR_VFX_MODEL_PROFILE,
    ...match,
    eyeHighlightMaterialPatterns:
      match?.eyeHighlightMaterialPatterns ??
      DEFAULT_AVATAR_VFX_MODEL_PROFILE.eyeHighlightMaterialPatterns,
    eyelineMaterialPatterns:
      match?.eyelineMaterialPatterns ??
      DEFAULT_AVATAR_VFX_MODEL_PROFILE.eyelineMaterialPatterns,
    eyelashMaterialPatterns:
      match?.eyelashMaterialPatterns ??
      DEFAULT_AVATAR_VFX_MODEL_PROFILE.eyelashMaterialPatterns,
    eyeMaterialPatterns:
      match?.eyeMaterialPatterns ??
      DEFAULT_AVATAR_VFX_MODEL_PROFILE.eyeMaterialPatterns,
    faceMaterialPatterns:
      match?.faceMaterialPatterns ??
      DEFAULT_AVATAR_VFX_MODEL_PROFILE.faceMaterialPatterns,
    eyeLayout: match?.eyeLayout ?? DEFAULT_AVATAR_VFX_MODEL_PROFILE.eyeLayout,
    faceLayout:
      match?.faceLayout ?? DEFAULT_AVATAR_VFX_MODEL_PROFILE.faceLayout,
  };
}

/**
 * How much larger than its iris a VRoid iris art cell (one texture half) is:
 * about 1.8–2.0 times on both Included Avatars, so iris art is drawn about
 * twice the size of the iris it covers.
 */
const VROID_IRIS_CELL_SCALE = 1.9;

function centre(rect: AvatarVFXNormalizedRect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Whether an iris rectangle sits in its VRoid half as VRoid lays it out:
 * inside it, roughly centred, and covering a good share of it (an Included
 * iris covers about half its half's width and height).
 */
function fitsVroidHalf(
  half: AvatarVFXNormalizedRect,
  iris: AvatarVFXNormalizedRect,
): boolean {
  const irisCentre = centre(iris);
  return (
    iris.x >= half.x &&
    iris.y >= half.y &&
    iris.x + iris.width <= half.x + half.width &&
    iris.y + iris.height <= half.y + half.height &&
    Math.abs(irisCentre.x - centre(half).x) <= half.width / 4 &&
    Math.abs(irisCentre.y - centre(half).y) <= half.height / 4 &&
    iris.width >= half.width * 0.4 &&
    iris.height >= half.height * 0.4
  );
}

/** A rectangle grown about its centre. */
function grownRect(
  rect: AvatarVFXNormalizedRect,
  scale: number,
): AvatarVFXNormalizedRect {
  const { x, y } = centre(rect);
  const width = rect.width * scale;
  const height = rect.height * scale;
  return { x: x - width / 2, y: y - height / 2, width, height };
}

/** Whether two rectangles overlap by at least half the smaller one's area. */
function mostlyOverlap(
  a: AvatarVFXNormalizedRect,
  b: AvatarVFXNormalizedRect,
): boolean {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return false;
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return width * height >= smaller * 0.5;
}

/**
 * The iris layout for one Avatar's eye texture. `layout` assumes a VRoid
 * iris texture: one iris per half, `left` being the viewer's left (the
 * Avatar's right eye). When an iris does not sit in its half that way, as
 * when the eyes share a texture atlas with other parts, each eye's art is
 * drawn in a cell around its own iris rectangle, scaled like VRoid's, and
 * clipped to that rectangle so it cannot reach the other eye.
 *
 * An eye whose UVs run mirrored against VRoid's (`textureMirrored`) has its
 * cell `flipped`, so its art reads on screen as on VRoid, `mirrorRight`
 * included. Eyes that share one rectangle draw the same art, unmirrored and
 * oriented for the viewer's left eye; with mirrored UVs the other eye then
 * shows it mirrored, as VRoid does.
 */
export function resolveIrisEyeLayout(
  layout: EyeLayout,
  eyes: AvatarFaceLandmarksSnapshot["eyes"],
): EyeLayout {
  const viewerLeft = eyes.right?.textureRect ?? null;
  const viewerRight = eyes.left?.textureRect ?? null;
  if (!viewerLeft || !viewerRight) return layout;
  const flippedLeft = eyes.right?.textureMirrored === true;
  const flippedRight = eyes.left?.textureMirrored === true;
  const flipped = (left: boolean, right: boolean) =>
    left || right ? { flipped: { left, right } } : {};
  if (
    fitsVroidHalf(layout.left, viewerLeft) &&
    fitsVroidHalf(layout.right, viewerRight)
  ) {
    return flippedLeft || flippedRight
      ? { ...layout, ...flipped(flippedLeft, flippedRight) }
      : layout;
  }
  const shared = mostlyOverlap(viewerLeft, viewerRight);
  return {
    left: grownRect(viewerLeft, VROID_IRIS_CELL_SCALE),
    right: grownRect(viewerRight, VROID_IRIS_CELL_SCALE),
    mirrorRight: shared ? false : layout.mirrorRight,
    clip: { left: viewerLeft, right: viewerRight },
    ...(shared
      ? flipped(flippedLeft, flippedLeft)
      : flipped(flippedLeft, flippedRight)),
  };
}
