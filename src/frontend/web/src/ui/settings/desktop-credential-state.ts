import type {
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
