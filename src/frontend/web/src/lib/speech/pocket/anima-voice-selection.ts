import { voiceEmotionForGroup, type ResolvedEmotionGroup } from "@/lib/emotion";

const POCKET_ANIMAMA_CATALOG_REF_PREFIX = "__pocket_anima_catalog_ref__:";

export type PocketAnimaVoiceSelectionContext = {
  animaId: string | null;
  emotionLabel: ResolvedEmotionGroup | null;
  emotionIntensity: number | null;
  animaVoiceCatalogUrl?: string | null;
};

export type PocketAnimaVoiceSelection = {
  animaId: string | null;
  animaVoiceKey: string | null;
  animaVoiceCatalogUrl: string | null;
};

function clampEmotionIntensity(value: number | null | undefined): 1 | 2 | 3 {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  if (value <= 1) return 1;
  if (value >= 3) return 3;
  return 2;
  // return Math.round(value) as 1 | 2 | 3;
}

export function buildPocketAnimaVoiceKey(
  emotionLabel: ResolvedEmotionGroup | null | undefined,
  emotionIntensity: number | null | undefined,
): string {
  const label = voiceEmotionForGroup(emotionLabel ?? "neutral");
  if (label === "neutral") {
    return "neutral";
  }
  return `${label}_${clampEmotionIntensity(emotionIntensity)}`;
}

export function resolvePocketAnimaVoiceSelection(
  context?: PocketAnimaVoiceSelectionContext | null,
): PocketAnimaVoiceSelection {
  const animaId = context?.animaId?.trim() ?? "";
  const animaVoiceCatalogUrl = context?.animaVoiceCatalogUrl?.trim() ?? "";
  if (!animaId) {
    return {
      animaId: null,
      animaVoiceKey: null,
      animaVoiceCatalogUrl: null,
    };
  }

  return {
    animaId,
    animaVoiceKey: buildPocketAnimaVoiceKey(
      context?.emotionLabel,
      context?.emotionIntensity,
    ),
    animaVoiceCatalogUrl: animaVoiceCatalogUrl || null,
  };
}

export function encodePocketAnimaCatalogReference(
  selection: PocketAnimaVoiceSelection,
): string | null {
  const animaId = selection.animaId?.trim() ?? "";
  if (!animaId) return null;

  const animaVoiceCatalogUrl = selection.animaVoiceCatalogUrl?.trim() ?? "";
  if (!animaVoiceCatalogUrl) {
    return animaId;
  }

  return `${POCKET_ANIMAMA_CATALOG_REF_PREFIX}${encodeURIComponent(
    JSON.stringify({
      animaId,
      animaVoiceCatalogUrl,
    }),
  )}`;
}

export { POCKET_ANIMAMA_CATALOG_REF_PREFIX };
