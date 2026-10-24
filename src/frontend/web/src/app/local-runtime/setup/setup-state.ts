import type { TFunction } from "i18next";
import { getI18n } from "react-i18next";
import type {
  PyModelConnection,
  PyModelConnectionDetection,
  PyModelProviderCatalogItem,
} from "@animama/runtime-contracts/api-types";
import {
  SETUP_STEPS,
  type SetupDraft,
  type SetupModelLocation,
  type SetupStep,
  type SetupSttChoice,
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
import type { OfflineSttEngine } from "@/lib/speech/offline-stt/routing";
import type { SttProviderOption } from "@/lib/speech/stt-provider";
import {
  connectionLocation,
  roleCandidates,
} from "@/ui/settings/models/model-configuration-state";

/** A step's label in the progress list. */
export function setupStepLabel(
  step: SetupStep,
  t: TFunction<"setup"> = getI18n().getFixedT(null, "setup"),
): string {
  switch (step) {
    case "welcome":
      return t("steps.welcome");
    case "ai":
      return t("steps.ai");
    case "voice":
      return t("steps.voice");
  }
}

/** "Step 2 of 3" for a step. */
export function setupStepPosition(
  step: SetupStep,
  t: TFunction<"setup"> = getI18n().getFixedT(null, "setup"),
): string {
  return t("progress.position", {
    current: SETUP_STEPS.indexOf(step) + 1,
    total: SETUP_STEPS.length,
  });
}

/** The neighbouring step, or null at either end. */
export function adjacentSetupStep(
  step: SetupStep,
  direction: 1 | -1,
): SetupStep | null {
  return SETUP_STEPS[SETUP_STEPS.indexOf(step) + direction] ?? null;
}

/** The built-in connections whose key the AI step takes. */
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

/** A built-in provider's key state and the model saving its key chooses. */
export type SetupBuiltin = {
  provider: SetupBuiltinProvider;
  /** Its key is set (in the desktop vault or the server environment). */
  ready: boolean;
  /** The model saving its key chooses, while the key is set; else null. */
  modelId: string | null;
};

/**
 * The AI step's built-in providers. Saving OpenAI's key chooses its default
 * Responses model and saving Anthropic's chooses Claude Haiku 5.5, each only
 * while its connection offers that model for chat.
 */
export function setupBuiltins(
  items: readonly PyModelProviderCatalogItem[],
  connections: readonly PyModelConnection[],
  systemDefaultId: string | null | undefined,
): Record<SetupBuiltinProvider, SetupBuiltin> {
  const builtin = (
    provider: SetupBuiltinProvider,
    model: PyModelProviderCatalogItem | null,
  ): SetupBuiltin => {
    const ready =
      builtinConnectionOf(connections, provider)?.credential_state ===
      "configured";
    return { provider, ready, modelId: ready ? (model?.id ?? null) : null };
  };
  return {
    openai: builtin(
      "openai",
      openAiDefaultModel(items, connections, systemDefaultId),
    ),
    anthropic: builtin("anthropic", anthropicDefaultModel(items, connections)),
  };
}

/** A chat model on one of the owner's connections, as the AI step tracks it. */
export type SetupModelChoice = {
  id: string;
  label: string;
  connectionName: string;
};

/**
 * The model saving the OpenAI key chooses: the built-in OpenAI Responses chat
 * model the system uses by default (`systemDefaultId`, from the Chat role), or
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
 * The model saving the Anthropic key chooses: Claude Haiku 5.5, Anthropic's
 * default, when the built-in Anthropic connection offers it for chat. The
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
 * step can have chosen by adding them. Built-in models are chosen only by
 * saving their provider's key.
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

/**
 * Setup's two provider tabs, with availability from App Settings' options.
 * The Voice step describes each one; built-in voices link to their model's
 * public page.
 */
export function setupTtsOptions(
  options: readonly TtsProviderOption[],
  t: TFunction<"setup"> = getI18n().getFixedT(null, "setup"),
): Array<{
  id: SetupTtsProvider;
  label: string;
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
      label: t("voice.tts.pocket.label"),
      disabled: pocket?.disabled ?? true,
      reason: pocket?.reason,
    },
    {
      id: "elevenlabs",
      label: t("voice.tts.elevenLabs.label"),
      disabled: elevenlabs?.disabled ?? true,
      reason: elevenlabs?.reason,
    },
  ];
}

/**
 * The Voice step's Speech-to-Text tabs, in order: the UI Locale's offline model
 * (CPU, then GPU), the other offline model, then the browser recognizers this
 * platform offers (none on desktop).
 */
export function setupSttChoices(
  engine: OfflineSttEngine,
  browserOptions: readonly SttProviderOption[],
): SetupSttChoice[] {
  const other: OfflineSttEngine =
    engine === "sensevoice" ? "parakeet" : "sensevoice";
  return [
    `${engine}_cpu`,
    `${engine}_gpu`,
    `${other}_cpu`,
    `${other}_gpu`,
    ...browserOptions.flatMap((option) =>
      option.id === "browser_external" || option.id === "browser_local"
        ? [option.id]
        : [],
    ),
  ];
}

/**
 * The selected Speech-to-Text tab: the owner's pick in this setup, else the
 * saved preference (an offline one shown as the UI Locale's model), else the
 * UI Locale's model on the CPU, which Setup recommends.
 */
export function resolveSetupSttChoice(
  draft: Pick<SetupDraft, "sttChoice">,
  saved: SpeechPreferences | null | undefined,
  engine: OfflineSttEngine,
  choices: readonly SetupSttChoice[],
): SetupSttChoice {
  if (draft.sttChoice && choices.includes(draft.sttChoice))
    return draft.sttChoice;
  const provider = saved?.stt_provider;
  if (provider === "parakeet")
    return saved?.stt_parakeet_webgpu === true
      ? `${engine}_gpu`
      : `${engine}_cpu`;
  if (
    (provider === "browser_external" || provider === "browser_local") &&
    choices.includes(provider)
  )
    return provider;
  return `${engine}_cpu`;
}

/**
 * The speech preferences a Speech-to-Text tab saves. Either offline model's
 * tab saves the offline provider and the GPU preference; the UI Locale picks
 * the model. A browser tab keeps the saved GPU preference.
 */
export function setupSttPatch(
  choice: SetupSttChoice,
): Pick<SpeechPreferences, "stt_provider" | "stt_parakeet_webgpu"> {
  if (choice === "browser_external" || choice === "browser_local")
    return { stt_provider: choice };
  return {
    stt_provider: "parakeet",
    stt_parakeet_webgpu: choice.endsWith("_gpu"),
  };
}
