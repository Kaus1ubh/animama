import type {
  CredentialChange,
  CredentialProvider,
  CredentialStatus,
  CredentialsBridge,
} from "../../../../shared/desktop-runtime";

/** Translate bounded main-process status into guidance without rendering raw errors. */
export function credentialFailureMessage(
  status: CredentialStatus,
): string | null {
  if (!status.error) return null;
  if (status.error === "runtime_busy")
    return "The key was not changed because Animama is still finishing local work. Wait, then retry.";
  if (status.error === "runtime_quiesce_failed")
    return "The key was not changed because local services could not stop safely. Retry the change; if it keeps failing, open Logs.";
  return status.restartRequired
    ? "The change could not finish. Saved key status is shown above. Open runtime recovery and retry before changing the key again."
    : "The previous key change could not finish. Check the saved status and retry the change.";
}

/** A ready old runtime is not evidence that the requested credential change succeeded. */
export async function applyCredentialChange(
  bridge: CredentialsBridge,
  provider: CredentialProvider,
  value?: string,
): Promise<CredentialStatus[]> {
  if (value === undefined) await bridge.delete(provider);
  else {
    const status = await bridge.set(provider, value);
    if (status.error || status.restartRequired)
      throw new Error("credential_change_failed");
  }
  const entries = await bridge.list();
  const result = entries.find((entry) => entry.provider === provider);
  if (
    !result ||
    result.error ||
    result.restartRequired ||
    result.configured !== (value !== undefined)
  )
    throw new Error("credential_change_failed");
  return entries;
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
 * Apply a batch with one local-service restart. Resolves with every provider's
 * status only when each change is confirmed by main's saved status; otherwise
 * rejects with `failed` (the providers that did not change) and `statuses`.
 * Typed keys are never kept for a retry; the owner re-enters them.
 */
export async function applyCredentialChanges(
  bridge: CredentialsBridge,
  changes: readonly CredentialChange[],
): Promise<CredentialStatus[]> {
  const statuses = await bridge.apply([...changes]);
  const failed = changes
    .filter((change) => {
      const status = statuses.find((item) => item.provider === change.provider);
      return (
        !status ||
        status.error ||
        status.restartRequired ||
        status.configured !== (change.value !== undefined)
      );
    })
    .map((change) => change.provider);
  if (failed.length > 0)
    throw Object.assign(new Error("credential_change_failed"), {
      failed,
      statuses,
    });
  return statuses;
}
