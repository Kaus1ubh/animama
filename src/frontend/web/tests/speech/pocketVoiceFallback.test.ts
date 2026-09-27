import { describe, expect, it } from "vitest";

import {
  resolveOncePerRun,
  resolvePocketFallbackVoice,
  type PerRunValue,
  type PocketVoiceAvailability,
} from "../../src/lib/speech/pocket/voice-preferences";

const voices = ["azelma", "eve", "noah"];

describe("resolvePocketFallbackVoice", () => {
  it("uses the default voice when nothing is saved", () => {
    expect(resolvePocketFallbackVoice(null, voices, false, "eve")).toEqual({
      voice: "eve",
    });
    expect(resolvePocketFallbackVoice(null, ["noah"], false, "eve")).toEqual({
      voice: "noah",
    });
  });

  it("keeps a saved voice the worker offers", () => {
    expect(resolvePocketFallbackVoice("noah", voices, false, "eve")).toEqual({
      voice: "noah",
    });
  });

  it("falls back to the default with a session notice for a removed voice", () => {
    const result = resolvePocketFallbackVoice("cosette", voices, false, "eve");
    expect(result.voice).toBe("eve");
    expect(result.notice).toMatchObject({
      scope: "session",
      key: "pocket_voice_unknown:cosette",
    });
    expect(result.notice?.message).toContain("cosette");
  });

  it("does not judge a saved voice before the worker reports its voices", () => {
    expect(resolvePocketFallbackVoice("cosette", [], false, "eve")).toEqual({
      voice: "cosette",
    });
  });

  it("reports a missing custom voice for the current run", () => {
    expect(resolvePocketFallbackVoice("custom", voices, false, "eve")).toEqual({
      voice: undefined,
      notice: {
        scope: "run",
        key: "pocket_custom_missing",
        message:
          "Custom PocketTTS voice is selected but no custom voice has been uploaded.",
      },
    });
    expect(resolvePocketFallbackVoice("custom", voices, true, "eve")).toEqual({
      voice: "custom",
    });
  });
});

describe("claimSessionNotice", () => {
  it("allows each notice once for the whole app session", async () => {
    const first = await import("../../src/lib/speech/pocket/voice-preferences");
    expect(first.claimSessionNotice("pocket_voice_unknown:cosette")).toBe(true);
    expect(first.claimSessionNotice("pocket_voice_unknown:cosette")).toBe(
      false,
    );
    expect(first.claimSessionNotice("pocket_voice_unknown:jean")).toBe(true);
    // Remounting a hook re-imports the same module instance, so state persists.
    const again = await import("../../src/lib/speech/pocket/voice-preferences");
    expect(again.claimSessionNotice("pocket_voice_unknown:cosette")).toBe(
      false,
    );
  });
});

describe("resolvePocketFallbackVoice with downloadable voices", () => {
  const listed = ["eve", "noah", "anna", "harriet"];
  const availability =
    (states: Record<string, PocketVoiceAvailability["status"]>) =>
    (id: string): PocketVoiceAvailability | null =>
      ["anna", "harriet"].includes(id)
        ? {
            status: states[id] ?? "not_installed",
            assetId: `pocket-voice-${id}`,
          }
        : null;

  it("uses an installed downloadable voice", () => {
    expect(
      resolvePocketFallbackVoice(
        "anna",
        listed,
        false,
        "eve",
        availability({ anna: "installed" }),
      ),
    ).toEqual({ voice: "anna" });
  });

  it("speaks with the default and installs a missing downloadable voice", () => {
    expect(
      resolvePocketFallbackVoice(
        "anna",
        listed,
        false,
        "eve",
        availability({}),
      ),
    ).toEqual({ voice: "eve", install: "pocket-voice-anna" });
  });

  it("waits quietly while the voice downloads", () => {
    expect(
      resolvePocketFallbackVoice(
        "anna",
        listed,
        false,
        "eve",
        availability({ anna: "downloading" }),
      ),
    ).toEqual({ voice: "eve" });
  });

  it("waits without installing until the install state is known", () => {
    expect(
      resolvePocketFallbackVoice(
        "anna",
        listed,
        false,
        "eve",
        availability({ anna: "unknown" }),
      ),
    ).toEqual({ voice: "eve" });
  });

  it("retries a failed download and notices once per session", () => {
    const result = resolvePocketFallbackVoice(
      "harriet",
      listed,
      false,
      "eve",
      availability({ harriet: "failed" }),
    );
    expect(result.voice).toBe("eve");
    expect(result.install).toBe("pocket-voice-harriet");
    expect(result.notice).toMatchObject({
      scope: "session",
      key: "pocket_voice_download_failed:harriet",
    });
  });
});

describe("resolveOncePerRun", () => {
  it("resolves once per run and again for the next run", () => {
    const cache: { current: PerRunValue<string> } = { current: null };
    let calls = 0;
    const resolve = () => `voice-${++calls}`;
    expect(resolveOncePerRun(cache, "run-1", resolve)).toBe("voice-1");
    // A download finishing mid-reply must not switch this run's voice.
    expect(resolveOncePerRun(cache, "run-1", resolve)).toBe("voice-1");
    expect(resolveOncePerRun(cache, "run-2", resolve)).toBe("voice-2");
    expect(calls).toBe(2);
  });
});
