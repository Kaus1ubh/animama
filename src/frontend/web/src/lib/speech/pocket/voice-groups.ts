import { getI18n } from "react-i18next";

import {
  POCKET_VOICES,
  type PocketVoice,
} from "@/lib/speech/pocket/voice-catalog";
import { POCKET_TTS_CUSTOM_VOICE } from "@/lib/speech/pocket/voice-preferences";

/** What the picker shows for one voice. */
export type PocketVoiceOption = Pick<
  PocketVoice,
  "id" | "name" | "accent" | "recommended"
>;

export type PocketVoiceGroup = {
  readonly label: string;
  readonly voices: readonly PocketVoiceOption[];
};

/**
 * Group the voices the Pocket worker reported for the voice picker: Female,
 * then Male, each in catalog order (recommended voices first). The worker's list
 * comes from the same catalog, so every reported voice has metadata.
 */
export function groupPocketVoices(
  available: readonly string[],
): PocketVoiceGroup[] {
  const t = getI18n().getFixedT(null, "animas");
  const reported = new Set(available);
  return (["female", "male"] as const)
    .map((gender) => ({
      label:
        gender === "female"
          ? t("voices.picker.filters.female")
          : t("voices.picker.filters.male"),
      voices: POCKET_VOICES.filter(
        (voice) => voice.gender === gender && reported.has(voice.id),
      ),
    }))
    .filter((group) => group.voices.length > 0);
}

/** The display name of a built-in voice, or the raw value for anything else. */
export function pocketVoiceLabel(id: string): string {
  if (id === POCKET_TTS_CUSTOM_VOICE) {
    const t = getI18n().getFixedT(null, "animas");
    return t("voices.picker.customUploaded");
  }
  return POCKET_VOICES.find((voice) => voice.id === id)?.name ?? id;
}

/**
 * Display name for a catalog accent. The generated catalog keeps the source
 * dataset's English accent; an accent without wording is shown as authored.
 */
export function pocketVoiceAccentLabel(accent: string): string {
  const t = getI18n().getFixedT(null, "voice");
  switch (accent) {
    case "American":
      return t("pocket.accents.american");
    case "Australian":
      return t("pocket.accents.australian");
    case "British":
      return t("pocket.accents.british");
    case "Canadian":
      return t("pocket.accents.canadian");
    case "English":
      return t("pocket.accents.english");
    case "Irish":
      return t("pocket.accents.irish");
    case "Northern Irish":
      return t("pocket.accents.northernIrish");
    case "Scottish":
      return t("pocket.accents.scottish");
    case "South African":
      return t("pocket.accents.southAfrican");
    default:
      return accent;
  }
}
