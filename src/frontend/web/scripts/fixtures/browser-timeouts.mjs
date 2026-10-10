/**
 * A browser step's bound in the fixture suites: generous enough for two-core CI
 * runners, where the Vite dev server compiles modules on the first navigation.
 * Tests that assert timing keep their own explicit bounds.
 */
export const BROWSER_STEP_TIMEOUT_MS = 30_000;
