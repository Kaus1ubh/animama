import { useEffect, useRef, useState } from "react";

import type { TuneSound } from "./model";

/**
 * One audition player for the whole page, so starting a sound anywhere (the
 * catalog, a sound dropdown) stops the one playing.
 */
export function useAudition() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (sound: TuneSound) => {
    audio.current?.pause();
    if (playing === sound.key) {
      setPlaying(null);
      return;
    }
    const next = new Audio(`/__tune/sound/${encodeURIComponent(sound.key)}`);
    next.addEventListener("ended", () => setPlaying(null));
    audio.current = next;
    setPlaying(sound.key);
    void next.play().catch(() => setPlaying(null));
  };
  return { playing, toggle };
}
