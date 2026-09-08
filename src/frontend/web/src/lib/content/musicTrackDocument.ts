export type MusicTrackDocument = {
  name: string;
  description: string;
  loop: boolean;
  gain: number;
  autoplay: boolean;
  file: File | null;
};

export const EMPTY_MUSIC_TRACK_DOCUMENT: MusicTrackDocument = {
  name: "",
  description: "",
  loop: true,
  gain: 1,
  autoplay: false,
  file: null,
};

/** Validate the creator-owned fields before an immutable release is created. */
export function validateMusicTrackDocument(
  document: MusicTrackDocument,
): string[] {
  const errors: string[] = [];
  if (!document.name.trim()) errors.push("Name is required.");
  if (!document.file) errors.push("Choose an audio file.");
  if (!Number.isFinite(document.gain) || document.gain < 0 || document.gain > 2)
    errors.push("Gain must be between 0 and 2.");
  return errors;
}
