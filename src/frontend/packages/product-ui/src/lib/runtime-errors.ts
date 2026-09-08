type ErrorDetail = {
  code?: unknown;
  current_revision?: unknown;
  field?: unknown;
  reason?: unknown;
};

function errorDetail(error: unknown): ErrorDetail {
  if (!error || typeof error !== "object") return {};
  const detail = Reflect.get(error, "detail");
  return detail && typeof detail === "object" ? (detail as ErrorDetail) : {};
}

export function runtimeContentErrorCode(error: unknown): string | null {
  const code = errorDetail(error).code;
  return typeof code === "string" ? code : null;
}

export function isRuntimeRemountRequired(error: unknown): boolean {
  return runtimeContentErrorCode(error) === "runtime_remount_required";
}
