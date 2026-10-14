import { afterEach, describe, expect, it, vi } from "vitest";

import {
  setPocketPcmRun,
  tapPocketPlayer,
  type PocketPlayerLike,
} from "./pocket-pcm-tap";
import {
  addSpeechPcmListener,
  addSpeechPlaybackListener,
  type SpeechPcmTapEvent,
  type SpeechPlaybackResumedEvent,
} from "./speech-pcm-tap";

function fakePlayer() {
  const listeners = new Map<string, (event: { detail?: unknown }) => void>();
  const played = vi.fn();
  const player: PocketPlayerLike = {
    playAudio: played,
    addEventListener: (name, listener) => listeners.set(name, listener),
  };
  return { player, played, listeners };
}

describe("Pocket PCM tap", () => {
  const stops: Array<() => void> = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    setPocketPcmRun(null);
  });

  it("taps what the player plays for the current run, once per player", () => {
    const pcm: SpeechPcmTapEvent[] = [];
    stops.push(addSpeechPcmListener((event) => pcm.push(event)));
    const { player, played } = fakePlayer();
    tapPocketPlayer(player);
    tapPocketPlayer(player);

    const chunk = new Float32Array(480);
    player.playAudio(chunk);
    setPocketPcmRun("run-1");
    player.playAudio(chunk);

    // Played both times; tapped once, for the run, and only once per chunk.
    expect(played).toHaveBeenCalledTimes(2);
    expect(pcm).toEqual([
      { runId: "run-1", provider: "pocket", sampleRate: 24_000, pcm: chunk },
    ]);
  });

  it("relays where playback resumed after an underrun", () => {
    const resumed: SpeechPlaybackResumedEvent[] = [];
    stops.push(addSpeechPlaybackListener((event) => resumed.push(event)));
    const { player, listeners } = fakePlayer();
    tapPocketPlayer(player);
    setPocketPcmRun("run-1");

    listeners.get("playbackResumed")!({
      detail: { playedSamples: 48_000, audioTime: 5.5, sampleRate: 24_000 },
    });
    listeners.get("playbackResumed")!({ detail: { playedSamples: 10 } });

    expect(resumed).toEqual([{ runId: "run-1", runSec: 2, contextSec: 5.5 }]);
  });

  it("ignores a missing player", () => {
    expect(() => tapPocketPlayer(null)).not.toThrow();
  });
});
