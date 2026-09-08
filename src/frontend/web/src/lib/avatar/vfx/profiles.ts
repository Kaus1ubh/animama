import type { AvatarVFXModelProfile, AvatarVFXNormalizedRect } from "./types";

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
