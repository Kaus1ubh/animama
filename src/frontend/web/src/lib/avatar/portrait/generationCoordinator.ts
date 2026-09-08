export type AvatarPortraitGenerationRunResult<T> =
  | { status: "completed"; value: T }
  | { status: "skipped" };

type InFlight<T> = {
  controller: AbortController;
  promise: Promise<T>;
  subscribers: number;
};

/** Coalesce visible loads and allow at most one attempt per producer key/session. */
export class AvatarPortraitGenerationCoordinator {
  private readonly completed = new Set<string>();
  private readonly inFlight = new Map<string, InFlight<unknown>>();

  run<T>({
    key,
    signal,
    operation,
  }: {
    key: string;
    signal: AbortSignal;
    operation: (signal: AbortSignal) => Promise<T>;
  }): Promise<AvatarPortraitGenerationRunResult<T>> {
    const current = this.inFlight.get(key) as InFlight<T> | undefined;
    if (current) return this.subscribe(current, signal);
    if (this.completed.has(key)) return Promise.resolve({ status: "skipped" });

    const controller = new AbortController();
    const entry: InFlight<T> = {
      controller,
      promise: Promise.resolve().then(() => operation(controller.signal)),
      subscribers: 0,
    };
    this.inFlight.set(key, entry as InFlight<unknown>);
    const clear = () => {
      if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
    };
    void entry.promise.then(() => {
      this.completed.add(key);
      clear();
    }, clear);
    return this.subscribe(entry, signal);
  }

  private subscribe<T>(
    entry: InFlight<T>,
    signal: AbortSignal,
  ): Promise<AvatarPortraitGenerationRunResult<T>> {
    entry.subscribers += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return false;
        settled = true;
        signal.removeEventListener("abort", abort);
        entry.subscribers -= 1;
        return true;
      };
      const abort = () => {
        if (!finish()) return;
        if (entry.subscribers === 0) entry.controller.abort();
        reject(new DOMException("Portrait cancelled.", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      entry.promise.then(
        (value) => {
          if (finish()) resolve({ status: "completed", value });
        },
        (error: unknown) => {
          if (finish()) reject(error);
        },
      );
    });
  }
}
