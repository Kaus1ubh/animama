type RecoverySession = {
  stopped: boolean;
  pending: Set<Promise<unknown>>;
  cleanup?: Promise<void>;
};

// Retain only a lifetime tombstone after cleanup: stale timers may still carry its key.
const hostedSessions = new Map<string, RecoverySession>();

/** Local installation namespaces remain durable; hosted lifetimes are explicitly registered. */
export function beginHostedRecoverySession(key: string): void {
  if (!hostedSessions.has(key))
    hostedSessions.set(key, { stopped: false, pending: new Set() });
}

export function recoverySessionIsActive(key: string): boolean {
  return !hostedSessions.get(key)?.stopped;
}

/** Track the whole write, including storage fallback, before a session can retire it. */
export async function writeSessionRecovery<T>(
  key: string,
  write: () => Promise<T>,
  stoppedResult: T,
): Promise<T> {
  const session = hostedSessions.get(key);
  if (session?.stopped) return stoppedResult;
  const operation = write();
  session?.pending.add(operation);
  try {
    const result = await operation;
    return session?.stopped ? stoppedResult : result;
  } finally {
    session?.pending.delete(operation);
  }
}

/** Fence immediately, drain started writes, then durably remove only this hosted namespace. */
export function endHostedRecoverySession(key: string): Promise<void> {
  const session: RecoverySession = hostedSessions.get(key) ?? {
    stopped: false,
    pending: new Set<Promise<unknown>>(),
  };
  hostedSessions.set(key, session);
  session.stopped = true;
  if (session.cleanup) return session.cleanup;
  session.cleanup = (async () => {
    await Promise.allSettled([...session.pending]);
    if (typeof window === "undefined") return;
    const prefix = `${encodeURIComponent(key)}:`;
    const results = await Promise.allSettled([
      purgeStore("animama-content-creator-recovery", "particle-vfx", prefix),
      purgeStore("animama-avatar-effect-creator-recovery", "drafts", prefix),
      purgeStore("animama-scene-effect-creator-recovery", "drafts", prefix),
      Promise.resolve().then(() => purgeRecoveryFallbacks(prefix)),
    ]);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length)
      throw new AggregateError(
        errors,
        "Hosted recovery could not all be removed",
      );
  })();
  return session.cleanup;
}

function purgeRecoveryFallbacks(prefix: string): void {
  const prefixes = [
    "animama:content-edit:",
    "animama:action-editor:",
    "anima.particleVfxCreator.recovery.v1:",
    "anima.avatarEffectCreator.recovery.v1:",
    "anima.sceneEffectCreator.recovery.v1:",
  ].map((family) => `${family}${prefix}`);
  const keys = Array.from({ length: window.localStorage.length }, (_, index) =>
    window.localStorage.key(index),
  );
  for (const key of keys)
    if (key && prefixes.some((family) => key.startsWith(family)))
      window.localStorage.removeItem(key);
}

/** Opening an absent database must not create empty recovery stores during logout. */
async function purgeStore(name: string, storeName: string, prefix: string) {
  if (!window.indexedDB) return;
  const database = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const opening = window.indexedDB.open(name);
    let absent = false;
    opening.onupgradeneeded = () => {
      absent = true;
      opening.transaction?.abort();
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => (absent ? resolve(null) : reject(opening.error));
    opening.onblocked = () => reject(new Error("Recovery storage is blocked"));
  });
  if (!database) return;
  try {
    if (!database.objectStoreNames.contains(storeName)) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const cursor = store.openKeyCursor(
        IDBKeyRange.bound(prefix, `${prefix}\uffff`),
      );
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        store.delete(entry.primaryKey);
        entry.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
