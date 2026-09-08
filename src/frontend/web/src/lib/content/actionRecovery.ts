import type { ActionDocument } from "@/ui/action-editor/actionDocument";

const RECOVERY_SCHEMA = 3;
const PREFIX = "animama:action-editor";

export type ActionRecovery = {
  schema: 3;
  userId: string;
  itemId: string | null;
  itemRevision: string | null;
  sessionId: string | null;
  sessionRevision: number | null;
  document: ActionDocument;
  rootDigest: string;
  savedAt: string;
};

export function actionRecoveryKey(
  userId: string,
  intent: ActionDocument["intent"],
  itemId: string | null,
) {
  return `${PREFIX}:${encodeURIComponent(userId)}:${intent}:${itemId ?? "new"}`;
}

/** Persist exact typed authoring state; local edit-session identifiers remain retryable. */
export function saveActionRecovery(
  storage: Pick<Storage, "setItem">,
  recovery: Omit<ActionRecovery, "schema" | "savedAt">,
  routeItemId: string | null = recovery.itemId,
) {
  storage.setItem(
    actionRecoveryKey(recovery.userId, recovery.document.intent, routeItemId),
    JSON.stringify({
      ...recovery,
      schema: RECOVERY_SCHEMA,
      savedAt: new Date().toISOString(),
    }),
  );
}

export function loadActionRecovery(
  storage: Pick<Storage, "getItem">,
  userId: string,
  intent: ActionDocument["intent"],
  itemId: string | null,
): ActionRecovery | null {
  const raw = storage.getItem(actionRecoveryKey(userId, intent, itemId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ActionRecovery>;
    if (
      parsed.schema !== RECOVERY_SCHEMA ||
      parsed.userId !== userId ||
      (itemId !== null && parsed.itemId !== itemId) ||
      parsed.document?.intent !== intent ||
      !parsed.rootDigest ||
      !parsed.savedAt
    ) {
      return null;
    }
    return parsed as ActionRecovery;
  } catch {
    return null;
  }
}

/**
 * Restore only an exact edit route. Product `/new` routes are authoritative
 * blank-document boundaries and must never revive a previous action.
 */
export function loadActionRecoveryForEditorRoute(
  storage: Pick<Storage, "getItem" | "removeItem">,
  userId: string,
  intent: ActionDocument["intent"],
  itemId: string | null,
): ActionRecovery | null {
  if (itemId === null) {
    clearActionRecovery(storage, userId, intent, null);
    return null;
  }
  return loadActionRecovery(storage, userId, intent, itemId);
}

export function clearActionRecovery(
  storage: Pick<Storage, "removeItem">,
  userId: string,
  intent: ActionDocument["intent"],
  itemId: string | null,
) {
  storage.removeItem(actionRecoveryKey(userId, intent, itemId));
}

/** Clear both the active route recovery and the canonical new-document slot. */
export function clearActionRecoveryForNewDocument(
  storage: Pick<Storage, "removeItem">,
  userId: string,
  intent: ActionDocument["intent"],
  currentItemId: string | null,
) {
  clearActionRecovery(storage, userId, intent, currentItemId);
  if (currentItemId !== null) {
    clearActionRecovery(storage, userId, intent, null);
  }
}

/** Stable digest suitable for change detection, not security decisions. */
export function actionDocumentDigest(document: ActionDocument) {
  const text = JSON.stringify(document);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
