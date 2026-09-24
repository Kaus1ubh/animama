/** Own the write/restore boundary for one browser recovery key. */
export class ContentRecoveryLifecycle {
  private generation = 0;
  private stopped = false;
  private pending: Promise<void> = Promise.resolve();

  capture(): number {
    return this.generation;
  }

  /** Timers and restore callbacks retain their token until they complete. */
  isCurrent(generation: number): boolean {
    return !this.stopped && generation === this.generation;
  }

  write<T>(
    generation: number,
    write: () => Promise<T>,
  ): Promise<T | undefined> {
    const operation = this.pending.then(() =>
      this.isCurrent(generation) ? write() : undefined,
    );
    this.pending = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  /** Fence immediately; already-running storage work must finish before deletion. */
  discard(clear: () => Promise<void>): Promise<void> {
    this.stopped = true;
    this.generation += 1;
    const operation = this.pending.then(clear);
    this.pending = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  /** The owner has installed a new document or explicitly kept the current draft. */
  resume(): void {
    this.stopped = false;
  }
}
