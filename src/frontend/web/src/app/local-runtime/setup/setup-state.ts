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
import {
  ANTHROPIC_DEFAULT_MODEL_ID,
  ANTHROPIC_MESSAGES_PROVIDER_TYPE,
  RESPONSES_PROVIDER_TYPE,
  alternateModelIds,
  modelDisplayName,
} from "@/lib/chat/model-catalog";
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

/** The built-in connections setup offers as "Use OpenAI" and "Use Anthropic". */
export type SetupBuiltinProvider = "openai" | "anthropic";

/** A built-in connection, found by its preset; each built-in has its own. */
export function builtinConnectionOf<
  C extends Pick<PyModelConnection, "source" | "preset">,
>(connections: readonly C[], preset: SetupBuiltinProvider): C | undefined {
  return connections.find(
    (connection) =>
      connection.source === "builtin" && connection.preset === preset,
  );
}

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
  const openAi = builtinConnectionOf(connections, "openai");
  const candidates = roleCandidates(items, "chat").filter(
    (item) =>
      openAi !== undefined &&
      item.connection_id === openAi.id &&
      item.model_provider === RESPONSES_PROVIDER_TYPE,
  );
  return (
    candidates.find((item) => item.id === systemDefaultId) ??
    candidates[0] ??
    null
  );
}

/**
 * The model "Use Anthropic" chooses: Claude Haiku 5.5, Anthropic's default,
 * when the built-in Anthropic connection offers it for chat. The
 * application default stays OpenAI's.
 */
export function anthropicDefaultModel(
  items: readonly PyModelProviderCatalogItem[],
  connections: readonly PyModelConnection[],
): PyModelProviderCatalogItem | null {
  const anthropic = builtinConnectionOf(connections, "anthropic");
  return (
    roleCandidates(items, "chat").find(
      (item) =>
        anthropic !== undefined &&
        item.connection_id === anthropic.id &&
        item.model_provider === ANTHROPIC_MESSAGES_PROVIDER_TYPE &&
        item.id === ANTHROPIC_DEFAULT_MODEL_ID,
    ) ?? null
  );
}

/**
 * Chat models on the owner's own connections in one location, which the AI
 * step lists as choices. Built-in models are offered only as "Use OpenAI"
 * and "Use Anthropic".
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

/** Text-to-Speech settings as the Voice step shows them. */
export type SetupTtsChoice = {
  enabled: boolean;
  provider: SetupTtsProvider;
};

/**
 * The Voice step's Text-to-Speech values: the owner's changes in this setup,
 * else the saved preferences, else off with built-in voices.
 */
export function resolveSetupTts(
  draft: Pick<SetupDraft, "ttsEnabled" | "ttsProvider">,
  saved: SpeechPreferences | null | undefined,
): SetupTtsChoice {
  const savedProvider =
    saved?.tts_provider === "elevenlabs" || saved?.tts_provider === "pocket_tts"
      ? saved.tts_provider
      : null;
  return {
    enabled: draft.ttsEnabled ?? saved?.tts_enabled === true,
    provider: draft.ttsProvider ?? savedProvider ?? "pocket_tts",
  };
}

/**
 * The speech preferences Finish merges into the saved ones, or null when the
 * owner changed nothing in the Voice step.
 */
export function setupTtsPatch(
  draft: Pick<SetupDraft, "ttsEnabled" | "ttsProvider">,
  saved: SpeechPreferences | null | undefined,
): Pick<SpeechPreferences, "tts_enabled" | "tts_provider"> | null {
  if (draft.ttsEnabled === null && draft.ttsProvider === null) return null;
  const { enabled, provider } = resolveSetupTts(draft, saved);
  return { tts_enabled: enabled, tts_provider: provider };
}

/** Setup's two default provider choices, with availability from App Settings' options. */
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
      label: "Built-in voices",
      description: "Runs on this computer; no key needed.",
      disabled: pocket?.disabled ?? true,
      reason: pocket?.reason,
    },
    {
      id: "elevenlabs",
      label: "ElevenLabs",
      description: "Cloud voices; needs an ElevenLabs API key.",
      disabled: elevenlabs?.disabled ?? true,
      reason: elevenlabs?.reason,
    },
  ];
}
