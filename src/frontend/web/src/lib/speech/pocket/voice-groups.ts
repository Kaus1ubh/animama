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

const GROUP_LABELS = {
  female: "Female voices",
  male: "Male voices",
} as const;

/**
 * Group the voices the Pocket worker reported for the voice picker: Female,
 * then Male, each in catalog order (recommended voices first). The worker's list
 * comes from the same catalog, so every reported voice has metadata.
 */
export function groupPocketVoices(
  available: readonly string[],
): PocketVoiceGroup[] {
  const reported = new Set(available);
  return (["female", "male"] as const)
    .map((gender) => ({
      label: GROUP_LABELS[gender],
      voices: POCKET_VOICES.filter(
        (voice) => voice.gender === gender && reported.has(voice.id),
      ),
    }))
    .filter((group) => group.voices.length > 0);
}

/** The display name of a built-in voice, or the raw value for anything else. */
export function pocketVoiceLabel(id: string): string {
  if (id === POCKET_TTS_CUSTOM_VOICE) return "Custom (uploaded)";
  return POCKET_VOICES.find((voice) => voice.id === id)?.name ?? id;
}
