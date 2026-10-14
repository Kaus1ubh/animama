/**
 * The PCM tap for Pocket TTS. The vendored core plays through its own player,
 * so the tap wraps that player's `playAudio` (once per player instance)
 * instead of changing the core, and relays where playback resumed after an
 * underrun.
 */

import {
  emitSpeechPcm,
  emitSpeechPlaybackResumed,
  playbackResumedAnchor,
} from "./speech-pcm-tap";

/** Pocket's playback rate; the vendored core plays at 24 kHz. */
const POCKET_SAMPLE_RATE = 24_000;

/** The parts of the vendored core's player the tap uses. */
export type PocketPlayerLike = {
  playAudio: (pcm: Float32Array) => unknown;
  addEventListener: (
    name: string,
    listener: (event: { detail?: unknown }) => void,
  ) => void;
};

/** The run whose audio the core is playing. */
let pocketRunId: string | null = null;
const tappedPlayers = new WeakSet<PocketPlayerLike>();

/** The run the next generation speaks for, or `null` between runs. */
export function setPocketPcmRun(runId: string | null): void {
  pocketRunId = runId;
}

/** Tap a player the core created; tapping it again does nothing. */
export function tapPocketPlayer(
  player: PocketPlayerLike | null | undefined,
): void {
  if (!player || tappedPlayers.has(player)) return;
  tappedPlayers.add(player);
  player.addEventListener("playbackResumed", (event) => {
    const anchor = playbackResumedAnchor(event?.detail);
    if (anchor && pocketRunId) {
      emitSpeechPlaybackResumed({ runId: pocketRunId, ...anchor });
    }
  });
  const playAudio = player.playAudio.bind(player);
  player.playAudio = (pcm: Float32Array) => {
    if (pocketRunId) {
      emitSpeechPcm({
        runId: pocketRunId,
        provider: "pocket",
        sampleRate: POCKET_SAMPLE_RATE,
        pcm,
      });
    }
    return playAudio(pcm);
  };
}
