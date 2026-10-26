/**
 * Tracks work that is still running, such as speech windows being transcribed,
 * so stopping dictation can let it finish before tearing the session down.
 */
export type InFlightWork = {
  /** Records `work` until it settles and returns it unchanged. */
  track<T>(work: Promise<T>): Promise<T>;
  /**
   * Resolves once every tracked promise has settled, or after `timeoutMs`.
   * Returns false when the wait ran out first.
   */
  settle(timeoutMs: number): Promise<boolean>;
};

export function createInFlightWork(): InFlightWork {
  const running = new Set<Promise<unknown>>();
  return {
    track(work) {
      running.add(work);
      const forget = () => {
        running.delete(work);
      };
      work.then(forget, forget);
      return work;
    },
    async settle(timeoutMs) {
      if (running.size === 0) return true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      });
      try {
        return await Promise.race([
          Promise.allSettled([...running]).then(() => true),
          timedOut,
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
