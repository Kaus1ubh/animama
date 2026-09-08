import type {
  AvatarEffectEditorDocument,
  AvatarEffectEditorImageResource,
} from "./types";

export const AVATAR_EFFECT_RECOVERY_SCHEMA =
  "animama/avatar-effect-recovery/1" as const;
const DATABASE_NAME = "animama-avatar-effect-creator-recovery";
const STORE_NAME = "drafts";
const MAX_RECOVERY_BYTES = 18 * 1024 * 1024;

export type AvatarEffectRecovery = {
  schema: typeof AVATAR_EFFECT_RECOVERY_SCHEMA;
  userId: string;
  documentKey: string;
  operationId: string;
  document: AvatarEffectEditorDocument;
  imageResource: AvatarEffectEditorImageResource | null;
  contentFingerprint: string;
  updatedAt: string;
};

export type AvatarEffectRecoveryWriteResult = {
  stored: boolean;
  metadataOnly: boolean;
  warning: string | null;
};

export async function saveAvatarEffectRecovery(
  recovery: AvatarEffectRecovery,
): Promise<AvatarEffectRecoveryWriteResult> {
  if (typeof window === "undefined")
    return { stored: false, metadataOnly: false, warning: null };
  const metadataBytes = new Blob([JSON.stringify(metadata(recovery))]).size;
  const totalBytes = metadataBytes + (recovery.imageResource?.file.size ?? 0);
  if (totalBytes > MAX_RECOVERY_BYTES) {
    return {
      stored: false,
      metadataOnly: false,
      warning:
        "This image is too large for browser crash recovery. Keep this tab open until Save completes.",
    };
  }
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
        warning: recovery.document.image
          ? "Image bytes could not be stored for crash recovery. Reselect the image after restoring this draft."
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

export async function loadAvatarEffectRecovery(
  userId: string,
  documentKey: string,
): Promise<AvatarEffectRecovery | null> {
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

export async function clearAvatarEffectRecovery(
  userId: string,
  documentKey: string,
): Promise<void> {
  if (typeof window === "undefined") return;
  clearFallback(userId, documentKey);
  try {
    const database = await openDatabase();
    await request(database, "readwrite", (store) =>
      store.delete(recoveryKey(userId, documentKey)),
    );
    database.close();
  } catch {
    // Clearing an unavailable recovery store is already the desired outcome.
  }
}

function metadata(recovery: AvatarEffectRecovery): AvatarEffectRecovery {
  return { ...recovery, imageResource: null };
}

function parseRecovery(
  value: unknown,
  userId: string,
  documentKey: string,
): AvatarEffectRecovery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<AvatarEffectRecovery>;
  if (
    record.schema !== AVATAR_EFFECT_RECOVERY_SCHEMA ||
    record.userId !== userId ||
    record.documentKey !== documentKey ||
    typeof record.operationId !== "string" ||
    typeof record.contentFingerprint !== "string" ||
    typeof record.updatedAt !== "string" ||
    !record.document ||
    record.document.schema !== "animama/avatar-effect-editor/1"
  ) {
    return null;
  }
  const resource = record.imageResource;
  let imageResource: AvatarEffectEditorImageResource | null = null;
  if (
    resource &&
    resource.file instanceof Blob &&
    typeof resource.sha256 === "string"
  ) {
    imageResource = {
      file:
        typeof File !== "undefined" && resource.file instanceof File
          ? resource.file
          : new File(
              [resource.file],
              record.document.image?.originalName ?? "effect.webp",
              {
                type: resource.file.type,
              },
            ),
      sha256: resource.sha256,
    };
  }
  return {
    schema: AVATAR_EFFECT_RECOVERY_SCHEMA,
    userId,
    documentKey,
    operationId: record.operationId,
    document: record.document,
    imageResource,
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
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const operation = action(transaction.objectStore(STORE_NAME));
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () =>
      reject(operation.error ?? new Error("IndexedDB request failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB aborted"));
  });
}

function recoveryKey(userId: string, documentKey: string): string {
  return `${encodeURIComponent(userId)}:${encodeURIComponent(documentKey)}`;
}

function fallbackKey(userId: string, documentKey: string): string {
  return `anima.avatarEffectCreator.recovery.v1:${recoveryKey(userId, documentKey)}`;
}

function clearFallback(userId: string, documentKey: string): void {
  try {
    window.localStorage.removeItem(fallbackKey(userId, documentKey));
  } catch {
    // Browser privacy settings may disable localStorage independently.
  }
}
