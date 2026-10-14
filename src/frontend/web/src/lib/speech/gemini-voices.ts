import type { GeminiTtsCapability } from "@animama/runtime-contracts/api-types";
import type { Client } from "@animama/runtime-contracts/sdk";
import type { TFunction } from "i18next";
import { getI18n } from "react-i18next";
import { getGeminiVoiceSampleV1GeminiVoicesVoiceSampleGet } from "@animama/runtime-contracts/sdk";

import type { GeminiTtsModelId } from "@/lib/settings/preferences";
import { sdkResultError } from "@/query/sdkResultError";
import type { PocketVoiceGender } from "@/lib/speech/pocket/voice-catalog";
import {
  VoiceSampleError,
  type VoiceSampleSource,
} from "@/lib/speech/pocket/voice-sample-player";

export type GeminiVoice = GeminiTtsCapability["voices"][number];

/** Google's one-word description of a voice, worded by `geminiVoiceDescription`. */
export type GeminiVoiceDescriptor =
  | "bright"
  | "upbeat"
  | "informative"
  | "firm"
  | "excitable"
  | "youthful"
  | "breezy"
  | "easyGoing"
  | "breathy"
  | "clear"
  | "smooth"
  | "gravelly"
  | "soft"
  | "even"
  | "mature"
  | "forward"
  | "friendly"
  | "casual"
  | "gentle"
  | "lively"
  | "knowledgeable"
  | "warm";

type GeminiVoiceDetails = {
  readonly gender: PocketVoiceGender;
  readonly description: GeminiVoiceDescriptor;
};

/**
 * Display details for Gemini's prebuilt voices. Genders follow Google Cloud's
 * Gemini-TTS voice list and descriptions the Gemini API speech-generation docs.
 * The runtime's capability stays the authority on which voices exist; a voice
 * missing here lists only under All, without a description.
 */
export const GEMINI_VOICE_DETAILS: Readonly<
  Partial<Record<string, GeminiVoiceDetails>>
> = {
  Zephyr: { gender: "female", description: "bright" },
  Puck: { gender: "male", description: "upbeat" },
  Charon: { gender: "male", description: "informative" },
  Kore: { gender: "female", description: "firm" },
  Fenrir: { gender: "male", description: "excitable" },
  Leda: { gender: "female", description: "youthful" },
  Orus: { gender: "male", description: "firm" },
  Aoede: { gender: "female", description: "breezy" },
  Callirrhoe: { gender: "female", description: "easyGoing" },
  Autonoe: { gender: "female", description: "bright" },
  Enceladus: { gender: "male", description: "breathy" },
  Iapetus: { gender: "male", description: "clear" },
  Umbriel: { gender: "male", description: "easyGoing" },
  Algieba: { gender: "male", description: "smooth" },
  Despina: { gender: "female", description: "smooth" },
  Erinome: { gender: "female", description: "clear" },
  Algenib: { gender: "male", description: "gravelly" },
  Rasalgethi: { gender: "male", description: "informative" },
  Laomedeia: { gender: "female", description: "upbeat" },
  Achernar: { gender: "female", description: "soft" },
  Alnilam: { gender: "male", description: "firm" },
  Schedar: { gender: "male", description: "even" },
  Gacrux: { gender: "female", description: "mature" },
  Pulcherrima: { gender: "female", description: "forward" },
  Achird: { gender: "male", description: "friendly" },
  Zubenelgenubi: { gender: "male", description: "casual" },
  Vindemiatrix: { gender: "female", description: "gentle" },
  Sadachbia: { gender: "male", description: "lively" },
  Sadaltager: { gender: "male", description: "knowledgeable" },
  Sulafat: { gender: "female", description: "warm" },
  // Every voice the contract names, and only those.
} satisfies Record<GeminiVoice, GeminiVoiceDetails>;

/** Google's descriptor for a voice, in the UI Locale. */
export function geminiVoiceDescription(
  descriptor: GeminiVoiceDescriptor,
  t: TFunction<"voice"> = getI18n().getFixedT(null, "voice"),
): string {
  switch (descriptor) {
    case "bright":
      return t("gemini.descriptors.bright");
    case "upbeat":
      return t("gemini.descriptors.upbeat");
    case "informative":
      return t("gemini.descriptors.informative");
    case "firm":
      return t("gemini.descriptors.firm");
    case "excitable":
      return t("gemini.descriptors.excitable");
    case "youthful":
      return t("gemini.descriptors.youthful");
    case "breezy":
      return t("gemini.descriptors.breezy");
    case "easyGoing":
      return t("gemini.descriptors.easyGoing");
    case "breathy":
      return t("gemini.descriptors.breathy");
    case "clear":
      return t("gemini.descriptors.clear");
    case "smooth":
      return t("gemini.descriptors.smooth");
    case "gravelly":
      return t("gemini.descriptors.gravelly");
    case "soft":
      return t("gemini.descriptors.soft");
    case "even":
      return t("gemini.descriptors.even");
    case "mature":
      return t("gemini.descriptors.mature");
    case "forward":
      return t("gemini.descriptors.forward");
    case "friendly":
      return t("gemini.descriptors.friendly");
    case "casual":
      return t("gemini.descriptors.casual");
    case "gentle":
      return t("gemini.descriptors.gentle");
    case "lively":
      return t("gemini.descriptors.lively");
    case "knowledgeable":
      return t("gemini.descriptors.knowledgeable");
    case "warm":
      return t("gemini.descriptors.warm");
  }
}

/** Google's English descriptor words, kept as search terms in every locale. */
const GEMINI_ENGLISH_DESCRIPTORS: Record<GeminiVoiceDescriptor, string> = {
  bright: "Bright",
  upbeat: "Upbeat",
  informative: "Informative",
  firm: "Firm",
  excitable: "Excitable",
  youthful: "Youthful",
  breezy: "Breezy",
  easyGoing: "Easy-going",
  breathy: "Breathy",
  clear: "Clear",
  smooth: "Smooth",
  gravelly: "Gravelly",
  soft: "Soft",
  even: "Even",
  mature: "Mature",
  forward: "Forward",
  friendly: "Friendly",
  casual: "Casual",
  gentle: "Gentle",
  lively: "Lively",
  knowledgeable: "Knowledgeable",
  warm: "Warm",
};

export type GeminiVoiceFilter = {
  gender: "any" | PocketVoiceGender;
  search: string;
};

/**
 * The offered voices matching a gender tab and a search over the name and the
 * description, in the UI Locale or in Google's English word.
 */
export function filteredGeminiVoices(
  voices: readonly GeminiVoice[],
  { gender, search }: GeminiVoiceFilter,
): GeminiVoice[] {
  const query = search.trim().toLocaleLowerCase();
  const t = getI18n().getFixedT(null, "voice");
  return voices.filter((voice) => {
    const details = GEMINI_VOICE_DETAILS[voice];
    const description = details
      ? `${geminiVoiceDescription(details.description, t)} ${GEMINI_ENGLISH_DESCRIPTORS[details.description]}`
      : "";
    return (
      (gender === "any" || details?.gender === gender) &&
      `${voice} ${description}`.toLocaleLowerCase().includes(query)
    );
  });
}

function sampleError(status: number, error: unknown): Error {
  const detail =
    error && typeof error === "object" && "detail" in error
      ? error.detail
      : null;
  const message =
    detail &&
    typeof detail === "object" &&
    "message" in detail &&
    typeof detail.message === "string"
      ? detail.message
      : null;
  // The backend's explanation is shown (as detail outside English); without
  // one, a plain error lets the player show its own worded failure.
  return message
    ? new VoiceSampleError(message)
    : new Error(`Gemini voice sample failed (HTTP ${status}).`);
}

/** A brief sample of a prebuilt voice; the backend speaks it once per model and keeps it. */
export async function loadGeminiVoiceSample(
  apiClient: Client,
  voice: GeminiVoice,
  modelId: GeminiTtsModelId,
  signal?: AbortSignal,
): Promise<Blob> {
  const result = await getGeminiVoiceSampleV1GeminiVoicesVoiceSampleGet({
    client: apiClient,
    path: { voice },
    query: { model_id: modelId },
    signal,
    parseAs: "blob",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-cache",
    responseValidator: undefined,
    throwOnError: false,
  });
  if (result.error !== undefined || !result.response?.ok)
    throw sdkResultError(result, sampleError);
  if (!(result.data instanceof Blob))
    throw new Error("The Gemini voice sample was not audio.");
  return result.data;
}

/** The picker's play source for one voice with the selected Gemini model. */
export function geminiVoiceSampleSource(
  apiClient: Client,
  modelId: GeminiTtsModelId,
  voice: GeminiVoice,
): VoiceSampleSource {
  return {
    id: voice,
    name: voice,
    loadSample: (signal) =>
      loadGeminiVoiceSample(apiClient, voice, modelId, signal),
  };
}
