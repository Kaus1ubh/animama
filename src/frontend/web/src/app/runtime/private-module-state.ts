const resets = new Set<() => void>();

/**
 * Registers a reset for a feature module's module-level private draft (for
 * example a pending save or a staged file). Every session end runs it, so
 * session teardown can clear lazily loaded features without importing them.
 * Call it once, at module load.
 */
export function registerPrivateStateReset(reset: () => void): void {
  resets.add(reset);
}

/** The registered resets; session teardown runs each one independently. */
export function privateStateResets(): (() => void)[] {
  return [...resets];
}
