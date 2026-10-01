import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/user-profile/display-name";

/** The three setup steps, in order. */
export const SETUP_STEPS = ["welcome", "ai", "voice"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** Where the AI step's models run. */
export type SetupModelLocation = "cloud" | "local";

/** Default Text-to-Speech providers setup offers: built-in voices or ElevenLabs. */
export type SetupTtsProvider = "pocket_tts" | "elevenlabs";

/**
 * Nonsecret first-run choices. They survive a renderer replaced by a rare
 * fallback restart after a failed key delivery; losing them only means
 * choosing again. API keys never enter this store.
 *
 * `chatModelId` is the catalog row chosen in the AI step (null: none, so the
 * system default applies). `ttsEnabled` and `ttsProvider` stay null until the
 * owner changes them in the Voice step, so untouched settings are not written.
 */
export type SetupDraft = {
  step: SetupStep;
  displayName: string;
  adultConfirmed: boolean;
  modelLocation: SetupModelLocation;
  chatModelId: string | null;
  ttsEnabled: boolean | null;
  ttsProvider: SetupTtsProvider | null;
};

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const MAX_DRAFT_LENGTH = 4096;
const MAX_MODEL_ID_LENGTH = 512;

export const emptySetupDraft = (): SetupDraft => ({
  step: "welcome",
  displayName: "",
  adultConfirmed: false,
  modelLocation: "cloud",
  chatModelId: null,
  ttsEnabled: null,
  ttsProvider: null,
});
const draftKey = (ownerId: string) => `animama:setup-draft:${ownerId}`;

function browserStorage(): DraftStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Keep only well-formed fields of a stored draft; anything else is reset. */
function parseDraft(value: unknown): SetupDraft {
  const empty = emptySetupDraft();
  if (!value || typeof value !== "object") return empty;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.displayName !== "string" ||
    raw.displayName.length > DISPLAY_NAME_MAX_LENGTH ||
    typeof raw.adultConfirmed !== "boolean"
  )
    return empty;
  const step = SETUP_STEPS.find((item) => item === raw.step) ?? "welcome";
  return {
    // A later step is never reachable without the Welcome answers.
    step: raw.displayName.trim() && raw.adultConfirmed ? step : "welcome",
    displayName: raw.displayName,
    adultConfirmed: raw.adultConfirmed,
    modelLocation: raw.modelLocation === "local" ? "local" : "cloud",
    chatModelId:
      typeof raw.chatModelId === "string" &&
      raw.chatModelId.length > 0 &&
      raw.chatModelId.length <= MAX_MODEL_ID_LENGTH
        ? raw.chatModelId
        : null,
    ttsEnabled: typeof raw.ttsEnabled === "boolean" ? raw.ttsEnabled : null,
    ttsProvider:
      raw.ttsProvider === "pocket_tts" || raw.ttsProvider === "elevenlabs"
        ? raw.ttsProvider
        : null,
  };
}

/** A draft is never proof of completed onboarding or installation readiness. */
export function readSetupDraft(
  ownerId: string,
  storage = browserStorage(),
): SetupDraft {
  try {
    const raw = storage?.getItem(draftKey(ownerId));
    if (!raw || raw.length > MAX_DRAFT_LENGTH) return emptySetupDraft();
    return parseDraft(JSON.parse(raw));
  } catch {
    return emptySetupDraft();
  }
}

/** Project exactly the draft's fields; API key drafts must never enter this store. */
export function writeSetupDraft(
  ownerId: string,
  draft: SetupDraft,
  storage = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    const projected: SetupDraft = {
      step: draft.step,
      displayName: draft.displayName.slice(0, DISPLAY_NAME_MAX_LENGTH),
      adultConfirmed: draft.adultConfirmed === true,
      modelLocation: draft.modelLocation === "local" ? "local" : "cloud",
      chatModelId: draft.chatModelId?.slice(0, MAX_MODEL_ID_LENGTH) || null,
      ttsEnabled: draft.ttsEnabled,
      ttsProvider: draft.ttsProvider,
    };
    storage.setItem(draftKey(ownerId), JSON.stringify(projected));
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
