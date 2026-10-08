import type {
  PyModelConnection,
  PyModelConnectionDetection,
  PyModelProviderCatalogItem,
} from "@animama/runtime-contracts/api-types";
import type { LocalOnboardingInput } from "@/app/local-runtime/LocalRuntimeProvider";
import {
  SETUP_STEPS,
  type SetupDraft,
  type SetupModelLocation,
  type SetupStep,
  type SetupTtsProvider,
} from "@/app/local-runtime/setup-draft";
import { alternateModelIds, modelDisplayName } from "@/lib/chat/model-catalog";
import type { SpeechPreferences } from "@/lib/settings/preferences";
import type { TtsProviderOption } from "@/lib/speech/tts-provider";
import {
  connectionLocation,
  roleCandidates,
} from "@/ui/settings/models/model-configuration-state";

/** Step labels for the progress list and its "Step 2 of 3" line. */
export const SETUP_STEP_LABELS: Record<SetupStep, string> = {
  welcome: "Welcome",
  ai: "AI",
  voice: "Voice",
};

/** "Step 2 of 3" for a step. */
export function setupStepPosition(step: SetupStep): string {
  return `Step ${SETUP_STEPS.indexOf(step) + 1} of ${SETUP_STEPS.length}`;
}

/** The neighbouring step, or null at either end. */
export function adjacentSetupStep(
  step: SetupStep,
  direction: 1 | -1,
): SetupStep | null {
  return SETUP_STEPS[SETUP_STEPS.indexOf(step) + direction] ?? null;
}

const RESPONSES_PROVIDER_TYPE = "OpenAIResponsesHTTPAgent";

/** A model the AI step can choose, with the name shown next to its radio. */
export type SetupModelChoice = {
  id: string;
  label: string;
  connectionName: string;
};

/**
 * The model "Use OpenAI" chooses: the built-in OpenAI Responses chat model
 * the system uses by default (`systemDefaultId`, from the Chat role), or
 * else the first visible one. Null when the catalog has none.
 */
export function openAiDefaultModel(
  items: readonly PyModelProviderCatalogItem[],
  connections: readonly PyModelConnection[],
  systemDefaultId: string | null | undefined,
): PyModelProviderCatalogItem | null {
  const builtin = new Set(
    connections
      .filter((connection) => connection.source === "builtin")
      .map((connection) => connection.id),
  );
  const candidates = roleCandidates(items, "chat").filter(
    (item) =>
      builtin.has(item.connection_id ?? "") &&
      item.model_provider === RESPONSES_PROVIDER_TYPE,
  );
  return (
    candidates.find((item) => item.id === systemDefaultId) ??
    candidates[0] ??
    null
  );
}

/**
 * Chat models on the owner's own connections in one location, which the AI
 * step lists as choices. Built-in OpenAI models are offered only as "Use
 * OpenAI".
 */
export function ownerModelChoices(
  items: readonly PyModelProviderCatalogItem[],
  connections: readonly PyModelConnection[],
  location: SetupModelLocation,
): SetupModelChoice[] {
  const byId = new Map(
    connections.map((connection) => [connection.id, connection]),
  );
  const listed = roleCandidates(items, "chat").filter((item) => {
    const connection = byId.get(item.connection_id ?? "");
    return (
      connection !== undefined &&
      connection.source !== "builtin" &&
      connectionLocation(connection) === location
    );
  });
  const alternates = alternateModelIds(listed);
  return listed.map((item) => ({
    id: item.id,
    label: modelDisplayName(item, alternates.has(item.id)),
    connectionName: byId.get(item.connection_id ?? "")?.name ?? "",
  }));
}

/**
 * Models a running server lists that are not yet added to Animama, so the
 * AI step can offer to add them. An existing connection to the same address
 * already lists its added models as choices.
 */
export function detectedModelsToAdd(
  detection: PyModelConnectionDetection,
  connections: readonly PyModelConnection[],
): string[] {
  const added = new Set(
    connections
      .filter(
        (connection) =>
          connection.preset === detection.preset &&
          sameBaseUrl(connection.base_url, detection.base_url),
      )
      .flatMap((connection) => connection.models ?? [])
      .map((model) => model.model),
  );
  return detection.models.filter((model) => !added.has(model));
}

/** The owner's connection to a detected server, if one exists. */
export function connectionForDetection(
  detection: PyModelConnectionDetection,
  connections: readonly PyModelConnection[],
): PyModelConnection | undefined {
  return connections.find(
    (connection) =>
      connection.source !== "builtin" &&
      connection.preset === detection.preset &&
      sameBaseUrl(connection.base_url, detection.base_url),
  );
}

function sameBaseUrl(left: string | null | undefined, right: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\/+$/u, "");
  return normalize(left ?? "") === normalize(right);
}

/**
 * The onboarding request: the Welcome answers and, when the AI step chose
 * one, the model that becomes the Chat default. A runtime that does not let
 * the owner configure models never sends one.
 */
export function onboardingInput(
  draft: Pick<SetupDraft, "adultConfirmed" | "chatModelId">,
  displayName: string,
  modelConfiguration: boolean,
): LocalOnboardingInput {
  return {
    displayName,
    adultConfirmed: draft.adultConfirmed,
    ...(modelConfiguration && draft.chatModelId
      ? { chatModelProviderId: draft.chatModelId }
      : {}),
  };
}

/**
 * The Voice step's Text-to-Speech provider: the owner's choice in this setup,
 * else the saved preference, else built-in voices.
 */
export function resolveSetupTtsProvider(
  draft: Pick<SetupDraft, "ttsProvider">,
  saved: SpeechPreferences | null | undefined,
): SetupTtsProvider {
  const savedProvider =
    saved?.tts_provider === "elevenlabs" || saved?.tts_provider === "pocket_tts"
      ? saved.tts_provider
      : null;
  return draft.ttsProvider ?? savedProvider ?? "pocket_tts";
}

/**
 * The speech preferences Finish merges into the saved ones, or null when the
 * owner kept the default provider. Text-to-Speech is on by default, so a
 * choice always keeps it on.
 */
export function setupTtsPatch(
  draft: Pick<SetupDraft, "ttsProvider">,
): Pick<SpeechPreferences, "tts_enabled" | "tts_provider"> | null {
  if (draft.ttsProvider === null) return null;
  return { tts_enabled: true, tts_provider: draft.ttsProvider };
}

/** Setup's two provider tabs, with availability from App Settings' options. */
export function setupTtsOptions(options: readonly TtsProviderOption[]): Array<{
  id: SetupTtsProvider;
  label: string;
  description: string;
  disabled: boolean;
  reason?: string;
}> {
  const find = (id: SetupTtsProvider) =>
    options.find((option) => option.id === id);
  const pocket = find("pocket_tts");
  const elevenlabs = find("elevenlabs");
  return [
    {
      id: "pocket_tts",
      label: "PocketTTS (built-in)",
      description:
        "Kyutai's Pocket TTS speaks replies on this computer, with no key or account needed.",
      disabled: pocket?.disabled ?? true,
      reason: pocket?.reason,
    },
    {
      id: "elevenlabs",
      label: "ElevenLabs",
      description: "Cloud voices with your ElevenLabs API key.",
      disabled: elevenlabs?.disabled ?? true,
      reason: elevenlabs?.reason,
    },
  ];
}
