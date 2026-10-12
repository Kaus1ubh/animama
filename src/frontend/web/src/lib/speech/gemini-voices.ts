import type { GeminiTtsCapability } from "@animama/runtime-contracts/api-types";
import type { Client } from "@animama/runtime-contracts/sdk";
import { getGeminiVoiceSampleV1GeminiVoicesVoiceSampleGet } from "@animama/runtime-contracts/sdk";

import type { GeminiTtsModelId } from "@/lib/settings/preferences";
import { sdkResultError } from "@/query/sdkResultError";
import type { PocketVoiceGender } from "@/lib/speech/pocket/voice-catalog";
import {
  VoiceSampleError,
  type VoiceSampleSource,
} from "@/lib/speech/pocket/voice-sample-player";

export type GeminiVoice = GeminiTtsCapability["voices"][number];

type GeminiVoiceDetails = {
  readonly gender: PocketVoiceGender;
  /** Google's one-word description of the voice. */
  readonly description: string;
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
  Zephyr: { gender: "female", description: "Bright" },
  Puck: { gender: "male", description: "Upbeat" },
  Charon: { gender: "male", description: "Informative" },
  Kore: { gender: "female", description: "Firm" },
  Fenrir: { gender: "male", description: "Excitable" },
  Leda: { gender: "female", description: "Youthful" },
  Orus: { gender: "male", description: "Firm" },
  Aoede: { gender: "female", description: "Breezy" },
  Callirrhoe: { gender: "female", description: "Easy-going" },
  Autonoe: { gender: "female", description: "Bright" },
  Enceladus: { gender: "male", description: "Breathy" },
  Iapetus: { gender: "male", description: "Clear" },
  Umbriel: { gender: "male", description: "Easy-going" },
  Algieba: { gender: "male", description: "Smooth" },
  Despina: { gender: "female", description: "Smooth" },
  Erinome: { gender: "female", description: "Clear" },
  Algenib: { gender: "male", description: "Gravelly" },
  Rasalgethi: { gender: "male", description: "Informative" },
  Laomedeia: { gender: "female", description: "Upbeat" },
  Achernar: { gender: "female", description: "Soft" },
  Alnilam: { gender: "male", description: "Firm" },
  Schedar: { gender: "male", description: "Even" },
  Gacrux: { gender: "female", description: "Mature" },
  Pulcherrima: { gender: "female", description: "Forward" },
  Achird: { gender: "male", description: "Friendly" },
  Zubenelgenubi: { gender: "male", description: "Casual" },
  Vindemiatrix: { gender: "female", description: "Gentle" },
  Sadachbia: { gender: "male", description: "Lively" },
  Sadaltager: { gender: "male", description: "Knowledgeable" },
  Sulafat: { gender: "female", description: "Warm" },
  // Every voice the contract names, and only those.
} satisfies Record<GeminiVoice, GeminiVoiceDetails>;

export type GeminiVoiceFilter = {
  gender: "any" | PocketVoiceGender;
  search: string;
};

/** The offered voices matching a gender tab and a name or description search. */
export function filteredGeminiVoices(
  voices: readonly GeminiVoice[],
  { gender, search }: GeminiVoiceFilter,
): GeminiVoice[] {
  const query = search.trim().toLocaleLowerCase();
  return voices.filter((voice) => {
    const details = GEMINI_VOICE_DETAILS[voice];
    return (
      (gender === "any" || details?.gender === gender) &&
      `${voice} ${details?.description ?? ""}`
        .toLocaleLowerCase()
        .includes(query)
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
  return new VoiceSampleError(
    message ?? `The voice sample could not be made (HTTP ${status}).`,
  );
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
    throw new VoiceSampleError("The voice sample could not be read.");
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
