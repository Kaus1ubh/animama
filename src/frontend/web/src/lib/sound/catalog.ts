import type { SoundCue } from "./types";

/** Built-in decorative cues stay empty until redistributable sounds are supplied.
 * Owner-provided typed Sound Effects continue through the runtime media catalog.
 */
export const SOUND_CATALOG: SoundCue[] = [];

const SOUND_CATALOG_BY_ID = new Map(
  SOUND_CATALOG.map((cue) => [cue.id, cue] as const),
);

export function getSoundCueById(cueId: string) {
  return SOUND_CATALOG_BY_ID.get(cueId) ?? null;
}
