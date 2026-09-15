/* Pocket TTS integration adapted for Animama by Raymond Van.
 * Includes third-party material under Apache-2.0; local additions retain the
 * repository license. Source and modification record:
 * licenses/third-party/code-and-models.md (repository root).
 */
export const POCKET_TTS_MAX_GAIN = 4;
export const POCKET_TTS_DEFAULT_GAIN = 2;

export function clampNormalizedPocketVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(1, numeric));
}

export function clampPocketGain(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return POCKET_TTS_DEFAULT_GAIN;
  }
  return Math.max(0, Math.min(POCKET_TTS_MAX_GAIN, numeric));
}

export function mapNormalizedVolumeToPocketGain(value) {
  return clampNormalizedPocketVolume(value) * POCKET_TTS_MAX_GAIN;
}
