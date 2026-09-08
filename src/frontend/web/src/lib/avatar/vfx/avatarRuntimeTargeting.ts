import type { AvatarVFXModelProfile, AvatarVFXTargetRole } from "./types";
import { resolveAvatarVFXModelProfile } from "./profiles";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";

type RuntimePrimitiveBindingEntry = ReturnType<
  typeof buildRuntimePrimitiveBindings
>["entries"][number];

const STRICT_FACE_PATTERN = /face.*skin|skin.*face/i;

export function normalizeAvatarMaterialName(
  value: string | null | undefined,
): string {
  return value?.trim().toLowerCase() ?? "";
}

export function matchAvatarTargetRole(
  materialName: string | null,
  profile: AvatarVFXModelProfile,
): AvatarVFXTargetRole | null {
  const normalizedName = normalizeAvatarMaterialName(materialName);
  if (!normalizedName) return null;

  if (
    profile.eyeHighlightMaterialPatterns?.some((pattern) =>
      pattern.test(normalizedName),
    )
  ) {
    return "eye_highlight";
  }
  if (
    profile.eyelineMaterialPatterns?.some((pattern) =>
      pattern.test(normalizedName),
    )
  ) {
    return "eyeline";
  }
  if (
    profile.eyelashMaterialPatterns?.some((pattern) =>
      pattern.test(normalizedName),
    )
  ) {
    return "eyelash";
  }
  if (
    profile.eyeMaterialPatterns?.some((pattern) => pattern.test(normalizedName))
  ) {
    return "eye_iris";
  }
  if (
    profile.faceMaterialPatterns?.some((pattern) =>
      pattern.test(normalizedName),
    )
  ) {
    return "face_skin";
  }
  return null;
}

function scoreFaceBinding(
  entry: RuntimePrimitiveBindingEntry,
  profile: AvatarVFXModelProfile,
): [number, number] | null {
  const normalizedName = normalizeAvatarMaterialName(entry.materialName);
  if (!normalizedName) return null;
  if (matchAvatarTargetRole(entry.materialName, profile) !== "face_skin") {
    return null;
  }

  const strictScore = STRICT_FACE_PATTERN.test(normalizedName) ? 2 : 1;
  const skinnedScore = entry.isSkinnedMesh ? 1 : 0;
  return [strictScore, skinnedScore];
}

export function resolveFaceTargetBinding(args: {
  sourceKey?: string | null;
  sourceUrl?: string | null;
  entries: RuntimePrimitiveBindingEntry[];
}): RuntimePrimitiveBindingEntry | null {
  const profile = resolveAvatarVFXModelProfile({
    sourceKey: args.sourceKey,
    sourceUrl: args.sourceUrl,
  });

  let bestEntry: RuntimePrimitiveBindingEntry | null = null;
  let bestScore: [number, number] | null = null;
  for (const entry of args.entries) {
    const score = scoreFaceBinding(entry, profile);
    if (!score) continue;
    if (
      !bestScore ||
      score[0] > bestScore[0] ||
      (score[0] === bestScore[0] && score[1] > bestScore[1])
    ) {
      bestEntry = entry;
      bestScore = score;
    }
  }

  return bestEntry;
}

export function resolveEyeIrisTargetBindings(args: {
  sourceKey?: string | null;
  sourceUrl?: string | null;
  entries: RuntimePrimitiveBindingEntry[];
}): RuntimePrimitiveBindingEntry[] {
  const profile = resolveAvatarVFXModelProfile({
    sourceKey: args.sourceKey,
    sourceUrl: args.sourceUrl,
  });

  return args.entries.filter(
    (entry) =>
      matchAvatarTargetRole(entry.materialName, profile) === "eye_iris",
  );
}
