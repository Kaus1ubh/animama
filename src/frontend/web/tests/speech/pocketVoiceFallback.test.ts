import { describe, expect, it } from "vitest";

import { resolvePocketFallbackVoice } from "../../src/lib/speech/pocket/voice-preferences";

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
