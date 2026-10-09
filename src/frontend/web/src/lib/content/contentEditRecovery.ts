export const CONTENT_EDIT_RECOVERY_SCHEMA = "animama/content-edit-recovery/1";

export type ContentEditRecovery = {
  schema: typeof CONTENT_EDIT_RECOVERY_SCHEMA;
  userId: string;
  family: string;
  documentKey: string;
  operationId: string;
  form: Record<string, unknown>;
  updatedAt: string;
};

function key(userId: string, family: string, documentKey: string) {
  return `animama:content-edit:${encodeURIComponent(userId)}:${encodeURIComponent(family)}:${encodeURIComponent(documentKey)}`;
}

/** Load bounded workflow identity and serializable form state after a crash. */
export function loadContentEditRecovery(
  userId: string,
  family: string,
  documentKey: string,
): ContentEditRecovery | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(userId, family, documentKey));
    if (!raw || raw.length > 64 * 1024) return null;
    const value = JSON.parse(raw) as Partial<ContentEditRecovery>;
    if (
      value.schema !== CONTENT_EDIT_RECOVERY_SCHEMA ||
      value.userId !== userId ||
      value.family !== family ||
      value.documentKey !== documentKey ||
      typeof value.operationId !== "string" ||
      !value.form ||
      typeof value.form !== "object"
    ) {
      return null;
    }
    return value as ContentEditRecovery;
  } catch {
    return null;
  }
}

/** Persist idempotency identity without file bytes or delivery capabilities. */
export function saveContentEditRecovery(recovery: ContentEditRecovery): void {
  if (
    typeof window === "undefined" ||
    !recoverySessionIsActive(recovery.userId)
  )
    return;
  try {
    window.localStorage.setItem(
      key(recovery.userId, recovery.family, recovery.documentKey),
      JSON.stringify(recovery),
    );
  } catch {
    // Recovery must never block an ordinary catalog Save.
  }
}

export function clearContentEditRecovery(
  userId: string,
  family: string,
  documentKey: string,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(userId, family, documentKey));
  } catch {
    // A missing recovery record is already the requested result.
  }
}
import { recoverySessionIsActive } from "./recovery-session";
