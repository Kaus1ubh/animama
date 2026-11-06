import { useCallback, useEffect, useRef, useState } from "react";
import { getI18n } from "react-i18next";

import type { PyContentPreview } from "@/lib/content/catalogTypes";
import {
  fetchContentPreviewFile,
  contentPreviewPrimaryFile,
} from "@/lib/content/contentPreview";
import { WordedError } from "@/lib/errors/apiError";
import { failureLine } from "@/lib/errors/apiError";

export type ContentPreviewAudioStatus =
  | "idle"
  | "loading"
  | "playing"
  | "blocked"
  | "ready"
  | "error";

/** Attempt one user-initiated preview playback without masking autoplay policy. */
export async function attemptContentPreviewAudioPlayback(
  audio: Pick<HTMLAudioElement, "play">,
): Promise<"playing" | "blocked"> {
  try {
    await audio.play();
    return "playing";
  } catch {
    return "blocked";
  }
}

/** Stop and rewind a replaced preview so sounds never overlap. */
export function stopContentPreviewAudioPlayback(
  audio: Pick<HTMLAudioElement, "pause" | "currentTime">,
): void {
  audio.pause();
  audio.currentTime = 0;
}

/** Fetch exact preview audio and play it from the originating Preview gesture. */
export function useContentPreviewAudio(preview: PyContentPreview | null) {
  const [state, setState] = useState<{
    url: string | null;
    error: string | null;
    status: ContentPreviewAudioStatus;
  }>({ url: null, error: null, status: "idle" });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const file = preview ? contentPreviewPrimaryFile(preview, "audio") : null;
    if (!preview || !file) {
      setState({ url: null, error: null, status: "idle" });
      return;
    }
    const t = getI18n().getFixedT(null, "actionEditor");
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setState({ url: null, error: null, status: "loading" });
    void (async () => {
      try {
        const response = await fetchContentPreviewFile(preview, file, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new WordedError(t("preview.errors.soundLoadFailed"));
        objectUrl = URL.createObjectURL(await response.blob());
        setState({ url: objectUrl, error: null, status: "loading" });
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            url: null,
            status: "error",
            error: failureLine(error, t("preview.errors.soundLoadFailed")),
          });
        }
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [preview]);

  useEffect(() => {
    if (!state.url) return;
    const audio = new Audio(state.url);
    audioRef.current = audio;
    const onEnded = () =>
      setState((current) => ({ ...current, status: "ready" }));
    audio.addEventListener("ended", onEnded);
    void attemptContentPreviewAudioPlayback(audio).then((status) => {
      if (audioRef.current === audio)
        setState((current) => ({ ...current, status }));
    });
    return () => {
      audio.removeEventListener("ended", onEnded);
      stopContentPreviewAudioPlayback(audio);
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [state.url]);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    const status = await attemptContentPreviewAudioPlayback(audio);
    if (audioRef.current === audio)
      setState((current) => ({ ...current, status }));
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    stopContentPreviewAudioPlayback(audio);
    setState((current) => ({ ...current, status: "ready" }));
  }, []);

  return { ...state, play, stop };
}
