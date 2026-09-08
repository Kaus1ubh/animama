export type SoundEffectDocument = {
  name: string;
  description: string;
  volume: number;
  filename: string | null;
};

/** Normalize the deliberately small Sound Effect authoring document. */
export function normalizeSoundEffectDocument(
  input: SoundEffectDocument,
): SoundEffectDocument {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("invalid_sound_effect_name");
  if (!Number.isFinite(input.volume) || input.volume < 0 || input.volume > 2) {
    throw new Error("invalid_sound_effect_volume");
  }
  return {
    name,
    description: input.description.trim(),
    volume: Math.round(input.volume * 100) / 100,
    filename: input.filename,
  };
}
