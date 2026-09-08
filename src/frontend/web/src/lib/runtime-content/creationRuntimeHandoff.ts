import type { PyAnimaRuntime } from "@/lib/content/catalogTypes";
import type { PreparedRuntimeMount } from "./RuntimeMountPreparer";

type Handoff = {
  owner: string;
  animaId: string;
  typed: PyAnimaRuntime;
  mount: PreparedRuntimeMount;
  leases: number;
  claimed: boolean;
  timeout: ReturnType<typeof setTimeout>;
  onConsumed: () => void;
};
const handoffs = new Map<string, Handoff>();
const key = (owner: string, animaId: string) =>
  `${owner.length}:${owner}:${animaId}`;

function dispose(entry: Handoff) {
  clearTimeout(entry.timeout);
  if (handoffs.get(key(entry.owner, entry.animaId)) === entry)
    handoffs.delete(key(entry.owner, entry.animaId));
  entry.mount.dispose();
}

/** Transfer already verified bytes in memory only. An abandoned navigation expires safely. */
export function offerCreationRuntime(
  owner: string,
  animaId: string,
  typed: PyAnimaRuntime,
  mount: PreparedRuntimeMount,
  onConsumed: () => void,
): () => void {
  const existing = handoffs.get(key(owner, animaId));
  if (existing) {
    if (existing.leases)
      throw new Error("This Anima runtime is already mounted.");
    dispose(existing);
  }
  const entry: Handoff = {
    owner,
    animaId,
    typed,
    mount,
    onConsumed,
    leases: 0,
    claimed: false,
    timeout: setTimeout(() => {
      if (!entry.leases) dispose(entry);
    }, 60_000),
  };
  handoffs.set(key(owner, animaId), entry);
  return () => {
    if (!entry.claimed) dispose(entry);
  };
}

/** A lease survives React's synchronous effect replay without preparing a second mount. */
export function claimCreationRuntime(
  owner: string,
  animaId: string,
  revision: string,
) {
  const entry = handoffs.get(key(owner, animaId));
  if (!entry || entry.typed.effective_revision !== revision) return null;
  clearTimeout(entry.timeout);
  entry.leases++;
  if (!entry.claimed) {
    entry.claimed = true;
    entry.onConsumed();
  }
  let released = false;
  return {
    mount: entry.mount,
    release: () => {
      if (released) return;
      released = true;
      entry.leases--;
      queueMicrotask(() => {
        if (entry.leases === 0 && handoffs.get(key(owner, animaId)) === entry)
          dispose(entry);
      });
    },
  };
}
