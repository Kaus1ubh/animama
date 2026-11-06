import { getI18n } from "react-i18next";

import { apiErrorLine, uncodedErrorText } from "@/lib/errors/apiError";

/** Public recordings and saved originals share one cancellable audio owner. */
export type VoiceSampleSource = { id: string; name: string } & (
  | { previewUrl: string }
  | { loadSample: (signal: AbortSignal) => Promise<Blob> }
  /** Why the sample cannot play, worded in the UI Locale. */
  | { sampleUnavailable: string }
);

/**
 * A sample failure whose English message is safe and useful to show: as is in
 * English, and as detail under the generic failure in other locales.
 */
export class VoiceSampleError extends Error {}

export type VoiceSampleState = {
  voiceId: string | null;
  status: "idle" | "loading" | "playing" | "error";
  /** A failed sample, worded in the UI Locale. */
  error: string | null;
};

export const IDLE_VOICE_SAMPLE: VoiceSampleState = {
  voiceId: null,
  status: "idle",
  error: null,
};

/** Click-only source samples; replacement, closure and unmount cancel all audio. */
export function createVoiceSamplePlayer(
  onChange: (state: VoiceSampleState) => void,
) {
  let controller: AbortController | null = null;
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let selected: string | null = null;

  function release() {
    controller?.abort();
    controller = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio = null;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    selected = null;
  }

  function stop() {
    release();
    onChange(IDLE_VOICE_SAMPLE);
  }

  async function play(voice: VoiceSampleSource) {
    if ("sampleUnavailable" in voice) {
      stop();
      return;
    }
    if (selected === voice.id) {
      stop();
      return;
    }
    release();
    selected = voice.id;
    const request = new AbortController();
    controller = request;
    onChange({ voiceId: voice.id, status: "loading", error: null });
    const fail = (message?: string) => {
      if (controller !== request) return;
      release();
      const t = getI18n().getFixedT(null, "voice");
      const fallback = t("pocket.sample.playFailed", { name: voice.name });
      onChange({
        voiceId: voice.id,
        status: "error",
        // A loader's explanation is backend or service English: shown as is
        // in English, else as detail under the generic failure.
        error: message
          ? apiErrorLine(uncodedErrorText(message, fallback))
          : fallback,
      });
    };
    try {
      // Local samples use the app's admitted byte transport. Public recordings
      // get no credentials or Referer; the cross-origin request still sends
      // Origin, which on desktop carries the installation's fixed loopback port.
      let blob: Blob;
      if ("loadSample" in voice) {
        blob = await voice.loadSample(request.signal);
      } else {
        const response = await fetch(voice.previewUrl, {
          signal: request.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        if (!response.ok) throw new Error("Sample unavailable");
        blob = await response.blob();
      }
      if (controller !== request) return;
      objectUrl = URL.createObjectURL(blob);
      const nextAudio = new Audio(objectUrl);
      audio = nextAudio;
      nextAudio.onended = () => {
        if (controller === request) stop();
      };
      nextAudio.onerror = () => fail();
      await nextAudio.play();
      if (controller === request)
        onChange({ voiceId: voice.id, status: "playing", error: null });
    } catch (error) {
      fail(error instanceof VoiceSampleError ? error.message : undefined);
    }
  }

  return { play, stop, dispose: release };
}
