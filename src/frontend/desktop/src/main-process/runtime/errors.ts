/** Runtime failures are safe categories; raw child output never becomes UI text. */
export class RuntimeError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function runtimeErrorCode(error: unknown): string {
  return error instanceof RuntimeError ? error.code : "runtime_start_failed";
}
