/**
 * Lip-sync capture files: one spoken reply's audio and what its planners need,
 * so the debug panel's Lip-sync view can compare plans for a reply without
 * speaking it. `pnpm lipsync:captures` makes them from the evaluation clips;
 * they hold audio, so they stay outside the repository.
 */

import type { TimedChar } from "@/lib/speech/provider-speech-timing";
import type { SpeechPcmProvider } from "@/lib/speech/speech-pcm-tap";
import { base64ToBytes, bytesToBase64 } from "./base64";

export const LIPSYNC_CAPTURE_FORMAT = "animama-lipsync-capture";

/** The decoded contents of a capture. */
export type LipSyncCapture = {
  id: string;
  provider: SpeechPcmProvider;
  sampleRate: number;
  pcm: Int16Array;
  /** The text sent to the voice, tags included. */
  text: string;
  /** Speech parts (Gemini) by the sample their audio starts at. */
  parts: Array<{ sample: number; text: string }>;
  /** Provider character timing on the capture's clock. */
  timing: TimedChar[];
};

export type LipSyncCaptureFile = Omit<LipSyncCapture, "pcm" | "timing"> & {
  format: typeof LIPSYNC_CAPTURE_FORMAT;
  version: 1;
  timing: Array<[string, number, number]>;
  /** 16-bit little-endian mono PCM, base64. */
  pcm: string;
};

const PROVIDERS: readonly SpeechPcmProvider[] = [
  "elevenlabs",
  "gemini",
  "pocket",
];

export function encodeLipSyncCapture(
  capture: LipSyncCapture,
): LipSyncCaptureFile {
  const bytes = new Uint8Array(capture.pcm.length * 2);
  const view = new DataView(bytes.buffer);
  capture.pcm.forEach((sample, index) =>
    view.setInt16(index * 2, sample, true),
  );
  return {
    format: LIPSYNC_CAPTURE_FORMAT,
    version: 1,
    id: capture.id,
    provider: capture.provider,
    sampleRate: capture.sampleRate,
    text: capture.text,
    parts: capture.parts,
    timing: capture.timing.map(({ char, startSec, endSec }) => [
      char,
      startSec,
      endSec,
    ]),
    pcm: bytesToBase64(bytes),
  };
}

/** A capture from a parsed file; throws with the reason when it is not one. */
export function decodeLipSyncCapture(value: unknown): LipSyncCapture {
  const file = (value ?? {}) as Partial<LipSyncCaptureFile>;
  if (file.format !== LIPSYNC_CAPTURE_FORMAT || file.version !== 1) {
    throw new Error("Not a lip-sync capture file (version 1)");
  }
  if (
    typeof file.id !== "string" ||
    !PROVIDERS.includes(file.provider as SpeechPcmProvider) ||
    typeof file.sampleRate !== "number" ||
    file.sampleRate <= 0 ||
    typeof file.text !== "string" ||
    typeof file.pcm !== "string" ||
    !Array.isArray(file.parts) ||
    !Array.isArray(file.timing)
  ) {
    throw new Error("The capture file is missing fields");
  }
  const bytes = base64ToBytes(file.pcm);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pcm = new Int16Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = view.getInt16(i * 2, true);
  return {
    id: file.id,
    provider: file.provider!,
    sampleRate: file.sampleRate,
    pcm,
    text: file.text,
    parts: file.parts,
    timing: file.timing.map(([char, startSec, endSec]) => ({
      char,
      startSec,
      endSec,
    })),
  };
}
