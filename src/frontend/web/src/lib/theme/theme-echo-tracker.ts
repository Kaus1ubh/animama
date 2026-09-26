/**
 * Distinguishes the server echoing this client's own theme saves from theme
 * changes made elsewhere.
 *
 * Each submitted value is counted until its stored copy arrives. A stored value
 * that matches a pending submission is consumed instead of applied, so a slow
 * response can never revert a newer local choice regardless of when the
 * request promise settles relative to the settings refresh.
 */
export function createThemeEchoTracker() {
  const pending = new Map<string, number>();
  return {
    /** Record a theme about to be sent to the server. */
    submit(theme: string) {
      pending.set(theme, (pending.get(theme) ?? 0) + 1);
    },
    /** Forget a submission whose request failed; no echo will arrive. */
    fail(theme: string) {
      const count = pending.get(theme) ?? 0;
      if (count <= 1) pending.delete(theme);
      else pending.set(theme, count - 1);
    },
    /** True (and consumed) when a stored theme is this client's own echo. */
    consumeEcho(theme: string): boolean {
      if (!pending.has(theme)) return false;
      this.fail(theme);
      return true;
    },
  };
}
