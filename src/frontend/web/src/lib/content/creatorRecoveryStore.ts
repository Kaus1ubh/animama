/**
 * Browser crash recovery shared by the effect creators.
 *
 * Each kind keeps its own IndexedDB database, object store, localStorage
 * fallback prefix and record schema, so drafts written before these creators
 * shared one implementation still load. Records are keyed by the encoded owner
 * and document key (`<owner>:<item id or "new">`). Recovery is authoring state
 * only: it never blocks Save, and write failures surface as warnings.
 */

import { getI18n } from "react-i18next";
import { WordedError } from "@/lib/errors/apiError";
import {
  recoverySessionIsActive,
  writeSessionRecovery,
} from "./recovery-session";

/** Identity every stored record carries and every load re-checks. */
export type CreatorRecoveryIdentity = {
  userId: string;
  documentKey: string;
};

export type CreatorRecoveryWriteResult = {
  stored: boolean;
  /** The fallback kept the document but dropped binary resources. */
  metadataOnly: boolean;
  warning: string | null;
};

/** How one kind stores its record in each storage medium. */
export type CreatorRecoveryCodec<TRecord extends CreatorRecoveryIdentity> = {
  /** Bytes counted against the kind's size cap, including Blob payloads. */
  measure(record: TRecord): number;
  /** Value written to IndexedDB. Structured clone keeps Blob payloads. */
  toDatabase(record: TRecord): unknown;
  /** localStorage text, or null when the record cannot be kept there. */
  toFallback(record: TRecord): { text: string; metadataOnly: boolean } | null;
  /**
   * Validate a stored value for exactly this owner and document. JSON text is
   * parsed before it reaches the codec.
   */
  parse(value: unknown, identity: CreatorRecoveryIdentity): TRecord | null;
};

export type CreatorRecoveryStoreConfig<
  TRecord extends CreatorRecoveryIdentity,
> = {
  databaseName: string;
  storeName: string;
  /** localStorage key prefix; the record key follows a colon. */
  fallbackKeyPrefix: string;
  /** Records larger than this are not stored at all. */
  maxBytes: number;
  codec: CreatorRecoveryCodec<TRecord>;
  /** Warnings; a function words the warning in the UI Locale when it is shown. */
  messages: {
    tooLarge: string | (() => string);
    unavailable: string | (() => string);
    /** Warning for a fallback write that dropped binary resources. */
    metadataOnly?: (record: TRecord) => string | null;
  };
};

function messageText(message: string | (() => string)): string {
  return typeof message === "function" ? message() : message;
}

export type CreatorRecoveryStore<TRecord extends CreatorRecoveryIdentity> = {
  save(record: TRecord): Promise<CreatorRecoveryWriteResult>;
  load(userId: string, documentKey: string): Promise<TRecord | null>;
  /**
   * Remove one document's recovery. Strict deletion is for explicit Discard:
   * it reports failures and waits for the IndexedDB commit. Ordinary cleanup
   * stays best-effort.
   */
  clear(
    userId: string,
    documentKey: string,
    options?: { strict?: boolean },
  ): Promise<void>;
};

/** Encode owner and document so neither can forge the other's key. */
export function creatorRecoveryKey(
  userId: string,
  documentKey: string,
): string {
  return `${encodeURIComponent(userId)}:${encodeURIComponent(documentKey)}`;
}

/** Bytes a string occupies once encoded, as browsers measure storage. */
export function creatorRecoveryTextBytes(text: string): number {
  return new Blob([text]).size;
}

/** Build one kind's recovery store over IndexedDB with a localStorage fallback. */
export function createCreatorRecoveryStore<
  TRecord extends CreatorRecoveryIdentity,
>(config: CreatorRecoveryStoreConfig<TRecord>): CreatorRecoveryStore<TRecord> {
  const { codec, messages } = config;
  const fallbackKey = (userId: string, documentKey: string) =>
    `${config.fallbackKeyPrefix}:${creatorRecoveryKey(userId, documentKey)}`;

  const clearFallback = (
    userId: string,
    documentKey: string,
    strict = false,
  ) => {
    try {
      window.localStorage.removeItem(fallbackKey(userId, documentKey));
    } catch (cause) {
      if (strict) throw cause;
      // Browser privacy settings may disable localStorage independently of IDB.
    }
  };

  /** JSON text is size-checked before parsing; structured values pass through. */
  const decode = (
    value: unknown,
    identity: CreatorRecoveryIdentity,
  ): TRecord | null => {
    if (typeof value === "string") {
      if (creatorRecoveryTextBytes(value) > config.maxBytes) return null;
      try {
        return codec.parse(JSON.parse(value) as unknown, identity);
      } catch {
        return null;
      }
    }
    return codec.parse(value, identity);
  };

  const saveRecord = async (
    record: TRecord,
  ): Promise<CreatorRecoveryWriteResult> => {
    if (typeof window === "undefined")
      return { stored: false, metadataOnly: false, warning: null };
    if (codec.measure(record) > config.maxBytes) {
      return {
        stored: false,
        metadataOnly: false,
        warning: messageText(messages.tooLarge),
      };
    }
    try {
      const database = await openDatabase(config);
      try {
        await databaseRequest(
          database,
          config.storeName,
          "readwrite",
          (store) =>
            store.put(
              codec.toDatabase(record),
              creatorRecoveryKey(record.userId, record.documentKey),
            ),
          // Report stored only once the write commits, so an aborted commit falls back.
          true,
        );
      } finally {
        database.close();
      }
      clearFallback(record.userId, record.documentKey);
      return { stored: true, metadataOnly: false, warning: null };
    } catch {
      try {
        const fallback = recoverySessionIsActive(record.userId)
          ? codec.toFallback(record)
          : null;
        if (fallback) {
          window.localStorage.setItem(
            fallbackKey(record.userId, record.documentKey),
            fallback.text,
          );
          return {
            stored: true,
            metadataOnly: fallback.metadataOnly,
            warning: fallback.metadataOnly
              ? (messages.metadataOnly?.(record) ?? null)
              : null,
          };
        }
      } catch {
        // The ordinary Save pipeline must not fail because recovery is unavailable.
      }
      return {
        stored: false,
        metadataOnly: false,
        warning: messageText(messages.unavailable),
      };
    }
  };

  return {
    save(record) {
      // A retired hosted session drops writes, and its purge waits for pending ones.
      return writeSessionRecovery(record.userId, () => saveRecord(record), {
        stored: false,
        metadataOnly: false,
        warning: null,
      });
    },

    async load(userId, documentKey) {
      if (typeof window === "undefined") return null;
      const identity = { userId, documentKey };
      try {
        const database = await openDatabase(config);
        let value: unknown;
        try {
          value = await databaseRequest(
            database,
            config.storeName,
            "readonly",
            (store) => store.get(creatorRecoveryKey(userId, documentKey)),
          );
        } finally {
          database.close();
        }
        return decode(value, identity);
      } catch {
        try {
          const raw = window.localStorage.getItem(
            fallbackKey(userId, documentKey),
          );
          return raw ? decode(raw, identity) : null;
        } catch {
          return null;
        }
      }
    },

    async clear(userId, documentKey, options = {}) {
      if (typeof window === "undefined") return;
      try {
        clearFallback(userId, documentKey, options.strict);
        // Without IndexedDB, recovery only uses the localStorage fallback.
        if (!window.indexedDB) return;
        const database = await openDatabase(config);
        try {
          await databaseRequest(
            database,
            config.storeName,
            "readwrite",
            (store) => store.delete(creatorRecoveryKey(userId, documentKey)),
            options.strict,
          );
        } finally {
          database.close();
        }
      } catch (cause) {
        if (options.strict) {
          const t = getI18n().getFixedT(null, "library");
          throw new WordedError(t("content.recovery.discardFailed"), {
            cause,
          });
        }
        // Save cleanup remains best-effort when browser storage is unavailable.
      }
    },
  };
}

function openDatabase(config: {
  databaseName: string;
  storeName: string;
}): Promise<IDBDatabase> {
  if (!window.indexedDB)
    return Promise.reject(new Error("IndexedDB unavailable"));
  return new Promise((resolve, reject) => {
    const opening = window.indexedDB.open(config.databaseName, 1);
    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains(config.storeName))
        opening.result.createObjectStore(config.storeName);
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () =>
      reject(opening.error ?? new Error("IndexedDB unavailable"));
    opening.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

/** Resolve on request success, or on transaction commit when asked to wait for it. */
function databaseRequest(
  database: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
  waitForCommit = false,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const operation = action(transaction.objectStore(storeName));
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

/** Narrow an unknown stored value to a plain object. */
export function recoveryRecordObject(
  value: unknown,
): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
