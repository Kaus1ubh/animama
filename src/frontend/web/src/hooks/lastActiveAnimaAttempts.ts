import { shouldPersistLastActiveAnima } from "@/ui/content-creator/contentCreatorModelPreview";

type LastActiveAnimaVisit = Parameters<typeof shouldPersistLastActiveAnima>[0];

/**
 * Persist each visited Anima at most once per visit.
 *
 * The remembering effect re-runs whenever settings or mutation state change,
 * including right after a failed write. Retrying from that effect would loop
 * as fast as React renders, so a failure waits until the owner opens another
 * Anima and returns.
 */
export function createLastActiveAnimaAttempts() {
  let attemptedAnimaId: string | null = null;
  return {
    remember(
      visit: LastActiveAnimaVisit,
      update: (animaId: string) => Promise<unknown>,
    ): void {
      // Opening any other Anima ends the visit that owned the last attempt.
      if (visit.routeAnimaId !== attemptedAnimaId) attemptedAnimaId = null;
      if (
        !shouldPersistLastActiveAnima(visit) ||
        attemptedAnimaId === visit.routeAnimaId
      ) {
        return;
      }
      const animaId = visit.routeAnimaId!;
      attemptedAnimaId = animaId;
      // A lost preference write is non-blocking; the next visit retries it.
      void update(animaId).catch(() => undefined);
    },
  };
}
