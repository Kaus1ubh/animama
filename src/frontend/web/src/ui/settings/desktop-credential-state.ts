import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/query/keys";
import {
  credentialTarget,
  type CredentialChange,
  type CredentialProvider,
  type CredentialStatus,
  type CredentialsBridge,
} from "../../../../shared/desktop-runtime";

/** Translate bounded main-process status into guidance without rendering raw errors. */
export function credentialFailureMessage(
  status: CredentialStatus,
): string | null {
  if (!status.error) return null;
  if (status.error === "connection_credentials_full")
    return "This computer already stores the most model connection keys it allows (32). Remove the key from a connection you no longer use, then retry.";
  return status.restartRequired
    ? "The change could not finish. Saved key status is shown above. Open runtime recovery and retry before changing the key again."
    : "The key change could not finish. Check the saved status and retry the change.";
}

/**
 * Pending edits in the API keys form, per provider: a new key to save, or a
 * request to remove the saved key. Blank inputs are not changes.
 */
export type CredentialDrafts = Partial<
  Record<CredentialProvider, { value?: string; remove?: boolean }>
>;

/** Turn form drafts into a batch; trimmed values, removal only when not replacing. */
export function credentialChangesFromDrafts(
  drafts: CredentialDrafts,
): CredentialChange[] {
  const changes: CredentialChange[] = [];
  for (const [provider, draft] of Object.entries(drafts) as Array<
    [CredentialProvider, CredentialDrafts[CredentialProvider]]
  >) {
    const value = draft?.value?.trim();
    if (value) changes.push({ provider, value });
    else if (draft?.remove) changes.push({ provider });
  }
  return changes;
}

/**
 * Saved keys apply to the running backend, so refresh the queries that report
 * key-dependent state: model availability and connection key status. Nothing
 * else caches provider key status.
 */
export async function refreshCredentialDependents(
  queryClient: QueryClient,
  ownerId: string | null | undefined,
): Promise<void> {
  const owner = ownerId ?? "__anon__";
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.modelProviders.all(owner),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.modelConfiguration.all(owner),
    }),
  ]);
}

/**
 * Save a batch and apply it to the running backend. Resolves with every status
 * only when each change is confirmed by main's saved status; otherwise rejects
 * with `failed` (the providers or connection variables that did not change)
 * and `statuses`. Typed keys are never kept for a retry; the owner re-enters
 * them.
 */
export async function applyCredentialChanges(
  bridge: CredentialsBridge,
  changes: readonly CredentialChange[],
): Promise<CredentialStatus[]> {
  const statuses = await bridge.apply([...changes]);
  const failed = changes
    .filter((change) => {
      const status = statuses.find(
        (item) => credentialTarget(item) === credentialTarget(change),
      );
      // A removed connection key has no entry left, which confirms the removal.
      if (!status)
        return !("connection" in change) || change.value !== undefined;
      return (
        status.error ||
        status.restartRequired ||
        status.configured !== (change.value !== undefined)
      );
    })
    .map(credentialTarget);
  if (failed.length > 0)
    throw Object.assign(new Error("credential_change_failed"), {
      failed,
      statuses,
    });
  return statuses;
}
