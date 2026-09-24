import type { ParticleVFXEditorCatalogDraft } from "@/lib/avatar/particle-vfx";
import type { JsonObject } from "@/lib/avatar/particle-vfx/editor/types";
export const PARTICLE_VFX_RECOVERY_SCHEMA =
  "animama/particle-effect-recovery/2";
export const PARTICLE_VFX_RECOVERY_MAX_BYTES = 5 * 1024 * 1024;
const LOCAL_STORAGE_FALLBACK_MAX_BYTES = 1024 * 1024;
const DATABASE_NAME = "animama-content-creator-recovery";
const STORE_NAME = "particle-vfx";

export type ParticleVFXRecovery = {
  schema: typeof PARTICLE_VFX_RECOVERY_SCHEMA;
  userId: string;
  documentKey: string;
  source: { itemId: string } | null;
  operationId: string;
  fileOperationIds: readonly string[];
  displayName: string;
  catalog: ParticleVFXEditorCatalogDraft;
  quarksJson: JsonObject;
  updatedAt: string;
};

export type ParticleVFXRecoveryWriteResult = {
  stored: boolean;
  warning: string | null;
};

function recoveryKey(
  userId: string,
  source: { itemId: string } | null,
): string {
  return `${encodeURIComponent(userId)}:${encodeURIComponent(source?.itemId ?? "new")}`;
}

/** Persist bounded raw authoring state without delivery capabilities or Blobs. */
export async function saveParticleVFXRecovery(
  recovery: ParticleVFXRecovery,
): Promise<ParticleVFXRecoveryWriteResult> {
  if (typeof window === "undefined") return { stored: false, warning: null };
  const serialized = JSON.stringify(recovery);
  const size = new Blob([serialized]).size;
  if (size > PARTICLE_VFX_RECOVERY_MAX_BYTES) {
    return {
      stored: false,
      warning:
        "This effect is too large for browser crash recovery. Save can still continue.",
    };
  }
  try {
    const database = await openDatabase();
    await databasePut(
      database,
      recoveryKey(recovery.userId, recovery.source),
      serialized,
    );
    database.close();
    clearLocalFallback(recovery.userId, recovery.source);
    return { stored: true, warning: null };
  } catch {
    if (size <= LOCAL_STORAGE_FALLBACK_MAX_BYTES) {
      try {
        window.localStorage.setItem(
          localFallbackKey(recovery.userId, recovery.source),
          serialized,
        );
        return { stored: true, warning: null };
      } catch {
        // The ordinary Save pipeline must not fail because recovery is unavailable.
      }
    }
    return {
      stored: false,
      warning:
        "Browser crash recovery is unavailable. Keep this tab open until Save finishes.",
    };
  }
}

/** Restore only a bounded record for the exact signed-in user and editor. */
export async function loadParticleVFXRecovery(
  userId: string,
  source: { itemId: string } | null,
): Promise<ParticleVFXRecovery | null> {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    const database = await openDatabase();
    raw = await databaseGet(database, recoveryKey(userId, source));
    database.close();
  } catch {
    try {
      raw = window.localStorage.getItem(localFallbackKey(userId, source));
    } catch {
      raw = null;
    }
  }
  if (!raw || new Blob([raw]).size > PARTICLE_VFX_RECOVERY_MAX_BYTES)
    return null;
  try {
    return parseRecovery(JSON.parse(raw) as unknown, userId, source);
  } catch {
    return null;
  }
}

/** Explicit Discard awaits the deletion commit and reports unavailable storage. */
export async function clearParticleVFXRecovery(
  userId: string,
  source: { itemId: string } | null,
  options: { strict?: boolean } = {},
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    clearLocalFallback(userId, source, options.strict);
    if (!window.indexedDB) return;
    const database = await openDatabase();
    try {
      await databaseDelete(
        database,
        recoveryKey(userId, source),
        options.strict,
      );
    } finally {
      database.close();
    }
  } catch (cause) {
    if (options.strict) {
      throw new Error(
        "Browser recovery could not be discarded. Please retry.",
        { cause },
      );
    }
    // Save cleanup remains best-effort when browser storage is unavailable.
  }
}

function parseRecovery(
  value: unknown,
  userId: string,
  source: { itemId: string } | null,
): ParticleVFXRecovery | null {
  const record = recordValue(value);
  if (
    !record ||
    record.schema !== PARTICLE_VFX_RECOVERY_SCHEMA ||
    record.userId !== userId ||
    record.documentKey !== (source?.itemId ?? "new") ||
    typeof record.operationId !== "string" ||
    typeof record.displayName !== "string" ||
    typeof record.updatedAt !== "string" ||
    !Array.isArray(record.fileOperationIds) ||
    !record.fileOperationIds.every((id) => typeof id === "string") ||
    !recordValue(record.catalog) ||
    !recordValue(record.quarksJson)
  ) {
    return null;
  }
  return {
    schema: PARTICLE_VFX_RECOVERY_SCHEMA,
    userId,
    documentKey: record.documentKey,
    source,
    operationId: record.operationId,
    fileOperationIds: record.fileOperationIds as string[],
    displayName: record.displayName,
    catalog: record.catalog as ParticleVFXEditorCatalogDraft,
    quarksJson: record.quarksJson as JsonObject,
    updatedAt: record.updatedAt,
  };
}

function openDatabase(): Promise<IDBDatabase> {
  if (!window.indexedDB)
    return Promise.reject(new Error("IndexedDB unavailable"));
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB unavailable"));
    request.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

function databaseGet(
  database: IDBDatabase,
  key: string,
): Promise<string | null> {
  return databaseRequest(database, "readonly", (store) => store.get(key)).then(
    (value) => (typeof value === "string" ? value : null),
  );
}

function databasePut(
  database: IDBDatabase,
  key: string,
  value: string,
): Promise<void> {
  return databaseRequest(database, "readwrite", (store) =>
    store.put(value, key),
  ).then(() => undefined);
}

function databaseDelete(
  database: IDBDatabase,
  key: string,
  waitForCommit = false,
): Promise<void> {
  return databaseRequest(
    database,
    "readwrite",
    (store) => store.delete(key),
    waitForCommit,
  ).then(() => undefined);
}

function databaseRequest(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
  waitForCommit = false,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => {
      if (!waitForCommit) resolve(request.result);
    };
    if (waitForCommit) transaction.oncomplete = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB aborted"));
  });
}

function localFallbackKey(
  userId: string,
  source: { itemId: string } | null,
): string {
  return `anima.particleVfxCreator.recovery.v1:${recoveryKey(userId, source)}`;
}

function clearLocalFallback(
  userId: string,
  source: { itemId: string } | null,
  strict = false,
): void {
  try {
    window.localStorage.removeItem(localFallbackKey(userId, source));
  } catch (cause) {
    if (strict) throw cause;
    // Browser privacy settings may disable localStorage independently of IDB.
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
