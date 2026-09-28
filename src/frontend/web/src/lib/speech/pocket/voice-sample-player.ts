/** Public recordings and saved originals share one cancellable audio owner. */
export type VoiceSampleSource = { id: string; name: string } & (
  | { previewUrl: string }
  | { loadSample: (signal: AbortSignal) => Promise<Blob> }
);

export type VoiceSampleState = {
  voiceId: string | null;
  status: "idle" | "loading" | "playing" | "error";
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
    if (selected === voice.id) {
      stop();
      return;
    }
    release();
    selected = voice.id;
    const request = new AbortController();
    controller = request;
    onChange({ voiceId: voice.id, status: "loading", error: null });
    const fail = () => {
      if (controller !== request) return;
      release();
      onChange({
        voiceId: voice.id,
        status: "error",
        error: `${voice.name}'s sample could not play. Check your connection and try again.`,
      });
    };
    try {
      // Local samples use the app's admitted byte transport. Public recordings
      // remain anonymous and never receive local request headers or credentials.
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
      nextAudio.onerror = fail;
      await nextAudio.play();
      if (controller === request)
        onChange({ voiceId: voice.id, status: "playing", error: null });
    } catch {
      fail();
    }
  }

  return { play, stop, dispose: release };
}
