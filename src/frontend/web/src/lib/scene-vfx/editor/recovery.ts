import type {
  SceneEffectEditorDocument,
  SceneEffectEditorImageResource,
} from "./types";

export const SCENE_EFFECT_RECOVERY_SCHEMA =
  "animama/scene-effect-recovery/1" as const;
const DATABASE_NAME = "animama-scene-effect-creator-recovery";
const STORE_NAME = "drafts";
const MAX_RECOVERY_BYTES = 34 * 1024 * 1024;

export type SceneEffectRecovery = {
  schema: typeof SCENE_EFFECT_RECOVERY_SCHEMA;
  userId: string;
  documentKey: string;
  operationId: string;
  document: SceneEffectEditorDocument;
  imageResources: SceneEffectEditorImageResource[];
  contentFingerprint: string;
  updatedAt: string;
};

export type SceneEffectRecoveryWriteResult = {
  stored: boolean;
  metadataOnly: boolean;
  warning: string | null;
};

export async function saveSceneEffectRecovery(
  recovery: SceneEffectRecovery,
): Promise<SceneEffectRecoveryWriteResult> {
  if (typeof window === "undefined")
    return { stored: false, metadataOnly: false, warning: null };
  const bytes =
    new Blob([JSON.stringify(metadata(recovery))]).size +
    recovery.imageResources.reduce(
      (sum, resource) => sum + resource.file.size,
      0,
    );
  if (bytes > MAX_RECOVERY_BYTES)
    return {
      stored: false,
      metadataOnly: false,
      warning:
        "These images are too large for browser crash recovery. Keep this tab open until Save completes.",
    };
  try {
    const database = await openDatabase();
    await request(database, "readwrite", (store) =>
      store.put(recovery, recoveryKey(recovery.userId, recovery.documentKey)),
    );
    database.close();
    clearFallback(recovery.userId, recovery.documentKey);
    return { stored: true, metadataOnly: false, warning: null };
  } catch {
    try {
      window.localStorage.setItem(
        fallbackKey(recovery.userId, recovery.documentKey),
        JSON.stringify(metadata(recovery)),
      );
      return {
        stored: true,
        metadataOnly: true,
        warning: recovery.imageResources.length
          ? "Image bytes could not be stored for crash recovery. Reselect private images after restoring this draft."
          : null,
      };
    } catch {
      return {
        stored: false,
        metadataOnly: false,
        warning:
          "Browser crash recovery is unavailable. Keep this tab open until Save completes.",
      };
    }
  }
}

export async function loadSceneEffectRecovery(
  userId: string,
  documentKey: string,
): Promise<SceneEffectRecovery | null> {
  if (typeof window === "undefined") return null;
  try {
    const database = await openDatabase();
    const value = await request(database, "readonly", (store) =>
      store.get(recoveryKey(userId, documentKey)),
    );
    database.close();
    return parseRecovery(value, userId, documentKey);
  } catch {
    try {
      const raw = window.localStorage.getItem(fallbackKey(userId, documentKey));
      return raw
        ? parseRecovery(JSON.parse(raw) as unknown, userId, documentKey)
        : null;
    } catch {
      return null;
    }
  }
}

/** Strict deletion is for explicit Discard: report failures and await durable commit. */
export async function clearSceneEffectRecovery(
  userId: string,
  documentKey: string,
  options: { strict?: boolean } = {},
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    clearFallback(userId, documentKey, options.strict);
    // Without IndexedDB, recovery only uses localStorage metadata.
    if (!window.indexedDB) return;
    const database = await openDatabase();
    try {
      await request(
        database,
        "readwrite",
        (store) => store.delete(recoveryKey(userId, documentKey)),
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

function metadata(recovery: SceneEffectRecovery): SceneEffectRecovery {
  return { ...recovery, imageResources: [] };
}

function parseRecovery(
  value: unknown,
  userId: string,
  documentKey: string,
): SceneEffectRecovery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<SceneEffectRecovery>;
  if (
    record.schema !== SCENE_EFFECT_RECOVERY_SCHEMA ||
    record.userId !== userId ||
    record.documentKey !== documentKey ||
    typeof record.operationId !== "string" ||
    typeof record.contentFingerprint !== "string" ||
    typeof record.updatedAt !== "string" ||
    record.document?.schema !== "animama/scene-effect-editor/1"
  )
    return null;
  const resources = Array.isArray(record.imageResources)
    ? record.imageResources.flatMap((resource) => {
        if (
          !resource ||
          !(resource.file instanceof Blob) ||
          typeof resource.logicalName !== "string" ||
          typeof resource.sha256 !== "string"
        )
          return [];
        const file =
          typeof File !== "undefined" && resource.file instanceof File
            ? resource.file
            : new File([resource.file], resource.logicalName, {
                type: resource.file.type,
              });
        return [
          { logicalName: resource.logicalName, file, sha256: resource.sha256 },
        ];
      })
    : [];
  return {
    schema: SCENE_EFFECT_RECOVERY_SCHEMA,
    userId,
    documentKey,
    operationId: record.operationId,
    document: record.document,
    imageResources: resources,
    contentFingerprint: record.contentFingerprint,
    updatedAt: record.updatedAt,
  };
}

function openDatabase(): Promise<IDBDatabase> {
  if (!window.indexedDB)
    return Promise.reject(new Error("IndexedDB unavailable"));
  return new Promise((resolve, reject) => {
    const opening = window.indexedDB.open(DATABASE_NAME, 1);
    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains(STORE_NAME))
        opening.result.createObjectStore(STORE_NAME);
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () =>
      reject(opening.error ?? new Error("IndexedDB unavailable"));
    opening.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

function request(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
  waitForCommit = false,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const operation = action(transaction.objectStore(STORE_NAME));
    operation.onsuccess = () => {
      if (!waitForCommit) resolve(operation.result);
    };
    if (waitForCommit) transaction.oncomplete = () => resolve(operation.result);
    operation.onerror = () =>
      reject(operation.error ?? new Error("IndexedDB request failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB aborted"));
  });
}

function recoveryKey(userId: string, documentKey: string) {
  return `${encodeURIComponent(userId)}:${encodeURIComponent(documentKey)}`;
}

function fallbackKey(userId: string, documentKey: string) {
  return `anima.sceneEffectCreator.recovery.v1:${recoveryKey(userId, documentKey)}`;
}

function clearFallback(userId: string, documentKey: string, strict = false) {
  try {
    window.localStorage.removeItem(fallbackKey(userId, documentKey));
  } catch (cause) {
    if (strict) throw cause;
    // Browser privacy settings may disable localStorage independently.
  }
}
