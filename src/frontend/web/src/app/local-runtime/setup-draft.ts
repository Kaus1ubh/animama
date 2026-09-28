import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/user-profile/display-name";

/** Nonsecret first-run fields survive native credential and model transitions. */
export type SetupDraft = { displayName: string; adultConfirmed: boolean };
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const emptyDraft = (): SetupDraft => ({
  displayName: "",
  adultConfirmed: false,
});
const draftKey = (ownerId: string) => `animama:setup-draft:${ownerId}`;

function browserStorage(): DraftStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** A draft is never proof of completed onboarding or installation readiness. */
export function readSetupDraft(
  ownerId: string,
  storage = browserStorage(),
): SetupDraft {
  try {
    const raw = storage?.getItem(draftKey(ownerId));
    if (!raw || raw.length > 2048) return emptyDraft();
    const value = JSON.parse(raw);
    if (
      !value ||
      typeof value.displayName !== "string" ||
      value.displayName.length > DISPLAY_NAME_MAX_LENGTH ||
      typeof value.adultConfirmed !== "boolean"
    )
      return emptyDraft();
    return {
      displayName: value.displayName,
      adultConfirmed: value.adultConfirmed,
    };
  } catch {
    return emptyDraft();
  }
}

/** Project exactly these two fields; API key drafts must never enter this store. */
export function writeSetupDraft(
  ownerId: string,
  draft: SetupDraft,
  storage = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      draftKey(ownerId),
      JSON.stringify({
        displayName: draft.displayName.slice(0, DISPLAY_NAME_MAX_LENGTH),
        adultConfirmed: draft.adultConfirmed === true,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Successful backend onboarding makes any stale draft irrelevant. */
export function clearSetupDraft(
  ownerId: string,
  storage = browserStorage(),
): void {
  try {
    storage?.removeItem(draftKey(ownerId));
  } catch {
    // Backend first-run state still prevents a completed installation reopening setup.
  }
}
