import { endHostedRecoverySession } from "@/lib/content/recovery-session";

const storageKey = "animama.hosted-recovery.v1";
const generationPattern = /^[A-Za-z0-9_-]{16,128}$/;
type Identity = { owner: string; generation: string; key: string };

/** This identifier chooses draft storage only. Every reload still requires fresh cookie admission. */
export async function hostedRecoveryIdentity(
  owner: string,
  generation: unknown,
  signal?: AbortSignal,
): Promise<string> {
  const fresh = () =>
    `hosted:${typeof generation === "string" && generationPattern.test(generation) ? generation : "ephemeral"}:${crypto.randomUUID()}`;
  if (typeof generation !== "string" || !generationPattern.test(generation))
    return fresh();
  let storage: Storage | undefined;
  let previous: Identity | null = null;
  try {
    storage = typeof window !== "undefined" ? window.sessionStorage : undefined;
    const raw = storage?.getItem(storageKey);
    if (raw && raw.length <= 2048) {
      const value = JSON.parse(raw) as Identity;
      if (
        typeof value.owner === "string" &&
        generationPattern.test(value.generation) &&
        value.key.startsWith(`hosted:${value.generation}:`) &&
        /^[a-f0-9-]{36}$/.test(
          value.key.slice(`hosted:${value.generation}:`.length),
        )
      )
        previous = value;
    }
  } catch {
    /* Storage denial withholds durable recovery, never admission. */
  }
  const same = previous?.owner === owner && previous.generation === generation;
  if (previous && !same) await endHostedRecoverySession(previous.key);
  signal?.throwIfAborted();
  // A new tab may inherit its opener's sessionStorage. Only a real reload/history
  // restoration may reuse that document's namespace; ordinary navigation starts afresh.
  const navigation = performance.getEntriesByType?.("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  const restore =
    navigation?.type === "reload" || navigation?.type === "back_forward";
  const key = same && restore ? previous!.key : fresh();
  try {
    storage?.setItem(storageKey, JSON.stringify({ owner, generation, key }));
  } catch {
    /* The current page can still edit without crash recovery. */
  }
  return key;
}

export function forgetHostedRecoveryIdentity(): void {
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    /* Unavailable storage. */
  }
}
