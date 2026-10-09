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

/** Fence writes, drain them, then remove every tab's drafts in the retired hosted generation. */
export function endHostedRecoverySession(key: string): Promise<void> {
  const session: RecoverySession = hostedSessions.get(key) ?? {
    stopped: false,
    pending: new Set<Promise<unknown>>(),
  };
  hostedSessions.set(key, session);
  session.stopped = true;
  const generation = /^hosted:([A-Za-z0-9_-]{16,128}):/.exec(key)?.[1];
  const namespace = generation ? `hosted:${generation}:` : key;
  // An older tab retiring must not delete a replacement session's newer drafts.
  for (const [otherKey, other] of hostedSessions)
    if (otherKey === key || (generation && otherKey.startsWith(namespace)))
      other.stopped = true;
  if (session.cleanup) return session.cleanup;
  session.cleanup = purgeHostedRecovery(
    [
      generation
        ? encodeURIComponent(namespace)
        : `${encodeURIComponent(key)}:`,
    ],
    key,
  );
  return session.cleanup;
}

/** Explicit account sign-out/denial removes history from every hosted generation. */
export function purgeHostedRecoverySessions(): Promise<void> {
  for (const session of hostedSessions.values()) session.stopped = true;
  return purgeHostedRecovery([
    "hosted%3A",
    ...[...hostedSessions.keys()].map((key) => `${encodeURIComponent(key)}:`),
  ]);
}

async function purgeHostedRecovery(
  prefixes: string[],
  key?: string,
): Promise<void> {
  await Promise.allSettled(
    [...hostedSessions.values()]
      .filter((other) => other.stopped)
      .flatMap((other) => [...other.pending]),
  );
  if (typeof window === "undefined") return;
  const results = await Promise.allSettled([
    purgeStore("animama-content-creator-recovery", "particle-vfx", prefixes),
    purgeStore("animama-avatar-effect-creator-recovery", "drafts", prefixes),
    purgeStore("animama-scene-effect-creator-recovery", "drafts", prefixes),
    Promise.resolve().then(() => purgeRecoveryFallbacks(prefixes)),
    Promise.resolve().then(() => {
      const raw = window.sessionStorage?.getItem("animama.hosted-recovery.v1");
      if (raw && raw.length <= 2048) {
        const identity = JSON.parse(raw) as { key?: string; owner?: string };
        if (!key || identity.key === key) {
          if (
            typeof identity.owner === "string" &&
            identity.owner.length <= 128
          )
            window.localStorage.removeItem(
              `animama.package-import.v1.${identity.owner}`,
            );
          window.sessionStorage.removeItem("animama.hosted-recovery.v1");
        }
      }
    }),
  ]);
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (errors.length)
    throw new AggregateError(
      errors,
      "Hosted recovery could not all be removed",
    );
}

function purgeRecoveryFallbacks(namespaces: string[]): void {
  const prefixes = [
    "animama:content-edit:",
    "animama:action-editor:",
    "anima.particleVfxCreator.recovery.v1:",
    "anima.avatarEffectCreator.recovery.v1:",
    "anima.sceneEffectCreator.recovery.v1:",
  ].flatMap((family) => namespaces.map((prefix) => `${family}${prefix}`));
  // These families key by the raw session key. Model download Retry hints
  // (query/model-download-coordination) hold only public asset IDs, but each
  // hosted tab writes its own key, so they end with the hosted session too.
  // A namespace (`hosted:<generation>:` or `<key>:`) covers the keys inside
  // it and the session key it ends with, such as an ephemeral lifetime's own.
  const rawKeys = namespaces
    .filter((prefix) => prefix.startsWith("hosted%3A"))
    .flatMap((prefix) =>
      ["animama.package-import.v1.", "animama:model-download-attempts:"].map(
        (family) => `${family}${decodeURIComponent(prefix)}`,
      ),
    );
  const keys = Array.from({ length: window.localStorage.length }, (_, index) =>
    window.localStorage.key(index),
  );
  for (const key of keys)
    if (
      key &&
      (prefixes.some((family) => key.startsWith(family)) ||
        rawKeys.some(
          (namespace) => key.startsWith(namespace) || `${key}:` === namespace,
        ))
    )
      window.localStorage.removeItem(key);
}

/** Opening an absent database must not create empty recovery stores during logout. */
async function purgeStore(name: string, storeName: string, prefixes: string[]) {
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
      for (const prefix of new Set(prefixes)) {
        const cursor = store.openKeyCursor(
          IDBKeyRange.bound(prefix, `${prefix}\uffff`),
        );
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          store.delete(entry.primaryKey);
          entry.continue();
        };
      }
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
