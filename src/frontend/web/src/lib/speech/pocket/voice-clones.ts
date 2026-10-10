import type { Client } from "@animama/runtime-contracts/sdk";
import type {
  PyTypedContentFile,
  PyVoiceContent,
} from "@animama/runtime-contracts/api-types";
import { streamContentFileV1ContentFilesFileRefGet } from "@animama/runtime-contracts/sdk";
import {
  ContentSaveApiError,
  contentSaveFieldError,
  toContentSaveApiError,
} from "@/lib/content/contentSaveErrors";
import { buildPocketVoiceCatalogFile } from "./catalog-builder";
import type { PocketVoiceEncoderOptions } from "./voice-cloning-encoder";
import type { VoiceSampleSource } from "./voice-sample-player";

export const POCKET_VOICE_CLONE_CODEC = "pocket-tts-catalog-v1";
export const MAX_VOICE_CLONE_FILE_BYTES = 25 * 1024 * 1024;

export type VoiceCloneDescriptor = Record<string, unknown> & {
  files: { path: string; role: string }[];
};

/** Retain this value across Save retries so encoding and save identity stay stable. */
export type PreparedVoiceClone = {
  entryName: string;
  operationId: string;
  descriptor: VoiceCloneDescriptor;
  files: File[];
  catalogItemId?: string;
  expectedRevision?: string;
};

export function voiceCloneName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120) {
    throw contentSaveFieldError(
      "Enter a voice name of 1–120 characters.",
      "name",
    );
  }
  return trimmed;
}

/** Use the recording name when no display name is supplied; only strip its final extension. */
export function voiceCloneNameFromFile(filename: string): string {
  return (
    filename
      .replace(/\.[^.]*$/, "")
      .trim()
      .slice(0, 120)
      .trim() || "Voice clone"
  );
}

function validateSize(file: Blob) {
  if (!file.size) {
    throw contentSaveFieldError("Choose a nonempty audio file.", "files");
  }
  if (file.size > MAX_VOICE_CLONE_FILE_BYTES) {
    throw contentSaveFieldError(
      "Each voice file must be 25 MiB or smaller.",
      "files",
    );
  }
}

/** Encode once while retaining the full original, including audio beyond encoder trimming. */
export async function prepareVoiceClone(
  apiClient: Client,
  {
    name = "",
    file,
    operationId = crypto.randomUUID(),
    encoder,
  }: {
    name?: string;
    file: File;
    operationId?: string;
    encoder?: PocketVoiceEncoderOptions;
  },
): Promise<PreparedVoiceClone> {
  const displayName = name.trim()
    ? voiceCloneName(name)
    : voiceCloneNameFromFile(file.name);
  validateSize(file);
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (!extension || !["wav", "mp3", "ogg"].includes(extension)) {
    throw contentSaveFieldError(
      "Choose a WAV, MP3, or Ogg recording.",
      "files",
    );
  }
  const id = crypto.randomUUID();
  const stem =
    displayName
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "voice";
  const encoded = await buildPocketVoiceCatalogFile(apiClient, {
    animaName: displayName,
    sources: [{ voiceName: "neutral", file }],
    ...(encoder ? { encoder } : {}),
  });
  validateSize(encoded);
  const originalPath = `original.${extension}`;
  return {
    entryName: `${stem}-${id}`,
    operationId,
    descriptor: {
      schema_version: 1,
      content_type: "voice",
      content_id: `local:voice:${id}`,
      name: displayName,
      codec: POCKET_VOICE_CLONE_CODEC,
      sample_rate_hz: 24000,
      voices: ["neutral"],
      provenance: { encoder: "pocket-tts", format_version: 1 },
      files: [
        { path: originalPath, role: "source_sample" },
        { path: "voice.bin", role: "pocket_voice_catalog" },
      ],
    },
    files: [
      new File([file], originalPath, { type: file.type }),
      new File([encoded], "voice.bin", { type: "application/octet-stream" }),
    ],
  };
}

/** Read admitted, registered bytes without exposing host paths or downloading a preset. */
export async function loadVoiceCloneFile(
  apiClient: Client,
  file: PyTypedContentFile,
  signal?: AbortSignal,
): Promise<Blob> {
  const result = await streamContentFileV1ContentFilesFileRefGet({
    client: apiClient,
    path: { file_ref: file.file_ref },
    signal,
    parseAs: "blob",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-cache",
    responseValidator: undefined,
    throwOnError: true,
  });
  if (!(result.data instanceof Blob)) {
    throw new Error("The saved voice file could not be read.");
  }
  validateSize(result.data);
  if (result.data.size !== file.size_bytes) {
    throw new Error("The saved voice file changed. Reload the voice library.");
  }
  return result.data;
}

/** Imported voices remain selectable even when their original recording was excluded. */
export function voiceCloneSampleSource(
  apiClient: Client,
  clone: PyVoiceContent,
): VoiceSampleSource {
  const source = { id: `clone:${clone.item_id}`, name: clone.name };
  const samples =
    clone.files?.filter((file) => file.role === "source_sample") ?? [];
  return clone.codec === POCKET_VOICE_CLONE_CODEC && samples.length === 1
    ? {
        ...source,
        loadSample: (signal) => loadVoiceCloneSample(apiClient, clone, signal),
      }
    : { ...source, sampleUnavailable: "Original recording unavailable" };
}

/** Original sample for the library player; its AbortSignal belongs to that player. */
export async function loadVoiceCloneSample(
  apiClient: Client,
  clone: PyVoiceContent,
  signal?: AbortSignal,
): Promise<Blob> {
  const samples =
    clone.files?.filter((file) => file.role === "source_sample") ?? [];
  if (clone.codec !== POCKET_VOICE_CLONE_CODEC || samples.length !== 1) {
    throw new Error("This voice does not have an original recording to play.");
  }
  return loadVoiceCloneFile(apiClient, samples[0], signal);
}

/** Preserve stable server codes while explaining the guarded-delete recovery. */
export function toVoiceCloneError(
  error: unknown,
  status: number | null = null,
) {
  const normalized = toContentSaveApiError(error, status);
  if (normalized.code !== "catalog_item_in_use") return normalized;
  return new ContentSaveApiError(
    normalized.status,
    normalized.code,
    "This voice is used by an Anima. Choose another voice for that Anima before deleting it.",
    normalized.reason,
    normalized.details,
    normalized.field,
  );
}
