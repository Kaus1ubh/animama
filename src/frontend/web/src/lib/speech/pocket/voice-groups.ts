import {
  POCKET_VOICES,
  type PocketVoice,
} from "@/lib/speech/pocket/voice-catalog";

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
 * then Male, each in catalog order (recommended voices first). A reported voice
 * missing from the catalog is still selectable under "Other voices".
 */
export function groupPocketVoices(
  available: readonly string[],
): PocketVoiceGroup[] {
  const reported = new Set(available);
  const known = new Set(POCKET_VOICES.map((voice) => voice.id));
  const groups: PocketVoiceGroup[] = (["female", "male"] as const).map(
    (gender) => ({
      label: GROUP_LABELS[gender],
      voices: POCKET_VOICES.filter(
        (voice) => voice.gender === gender && reported.has(voice.id),
      ),
    }),
  );
  const unknown = available.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    groups.push({
      label: "Other voices",
      voices: unknown.map((id) => ({
        id,
        name: id,
        accent: null,
        recommended: false,
      })),
    });
  }
  return groups.filter((group) => group.voices.length > 0);
}

/** The display name of a built-in voice, or the raw value for anything else. */
export function pocketVoiceLabel(id: string): string {
  if (id === "custom") return "Custom (uploaded)";
  return POCKET_VOICES.find((voice) => voice.id === id)?.name ?? id;
}
