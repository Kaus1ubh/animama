import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVoiceSamplePlayer,
  IDLE_VOICE_SAMPLE,
} from "./voice-sample-player";

const voice = {
  id: "eve",
  name: "Eve",
  previewUrl: "https://example.test/eve.wav",
};
const instances: FakeAudio[] = [];
class FakeAudio {
  src: string;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  constructor(src: string) {
    this.src = src;
    instances.push(this);
  }
}

describe("voice source samples", () => {
  beforeEach(() => {
    instances.length = 0;
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["sample"]),
      }),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sample");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does nothing until play, fetches anonymously, and stops on a second click", async () => {
    const changed = vi.fn();
    const player = createVoiceSamplePlayer(changed);
    expect(fetch).not.toHaveBeenCalled();
    await player.play(voice);
    expect(fetch).toHaveBeenCalledWith(
      voice.previewUrl,
      expect.objectContaining({
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
    expect(changed).toHaveBeenLastCalledWith({
      voiceId: "eve",
      status: "playing",
      error: null,
    });
    await player.play(voice);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(instances[0].pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:sample");
    expect(changed).toHaveBeenLastCalledWith(IDLE_VOICE_SAMPLE);
  });

  it("ignores a slow replaced sample even if fetch ignores abort", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve as typeof finish;
        }),
    );
    const changed = vi.fn();
    const player = createVoiceSamplePlayer(changed);
    const first = player.play(voice);
    await player.play({ ...voice, id: "azelma", name: "Azelma" });
    finish({ ok: true, blob: async () => new Blob() });
    await first;
    expect(instances).toHaveLength(1);
    expect(changed).toHaveBeenLastCalledWith({
      voiceId: "azelma",
      status: "playing",
      error: null,
    });
    player.dispose();
    expect(instances[0].pause).toHaveBeenCalled();
  });

  it("loads a saved original through its admitted byte loader without public fetch", async () => {
    const loadSample = vi.fn().mockResolvedValue(new Blob(["original"]));
    const changed = vi.fn();
    const player = createVoiceSamplePlayer(changed);
    await player.play({ id: "clone:one", name: "My voice", loadSample });
    expect(fetch).not.toHaveBeenCalled();
    expect(loadSample).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(changed).toHaveBeenLastCalledWith({
      voiceId: "clone:one",
      status: "playing",
      error: null,
    });
    await player.play(voice);
    expect(instances[0].pause).toHaveBeenCalled();
    player.dispose();
  });

  it("aborts a saved sample load when the selected voice changes", async () => {
    let finish!: (blob: Blob) => void;
    const loadSample = vi.fn<(signal: AbortSignal) => Promise<Blob>>(
      () =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        }),
    );
    const player = createVoiceSamplePlayer(vi.fn());
    const playing = player.play({
      id: "clone:one",
      name: "My voice",
      loadSample,
    });
    player.stop();
    expect(loadSample.mock.calls[0][0].aborted).toBe(true);
    finish(new Blob(["late original"]));
    await playing;
    expect(instances).toHaveLength(0);
  });

  it("cancels pending playback on closure without reporting an error", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve as typeof finish;
        }),
    );
    const changed = vi.fn();
    const player = createVoiceSamplePlayer(changed);
    const playing = player.play(voice);
    player.dispose();
    finish({ ok: true, blob: async () => new Blob() });
    await playing;
    expect(instances).toHaveLength(0);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("reports network failures and permits a retry", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    const changed = vi.fn();
    const player = createVoiceSamplePlayer(changed);
    await player.play(voice);
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "error",
        error: expect.stringContaining("try again"),
      }),
    );
    await player.play(voice);
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "playing" }),
    );
    instances[0].onended?.();
    expect(changed).toHaveBeenLastCalledWith(IDLE_VOICE_SAMPLE);
  });

  it("releases rejected and undecodable audio", async () => {
    const changed = vi.fn();
    const player = createVoiceSamplePlayer(changed);
    await player.play(voice);
    instances[0].onerror?.();
    expect(instances[0].pause).toHaveBeenCalled();
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });
});
