export type CommitOutcome = { animaId: string; ok: boolean; message?: string };

/** Preserve successes and return only failed targets for an explicit retry. */
export function failedActionTargets(outcomes: CommitOutcome[]): string[] {
  return outcomes
    .filter((outcome) => !outcome.ok)
    .map((outcome) => outcome.animaId);
}
