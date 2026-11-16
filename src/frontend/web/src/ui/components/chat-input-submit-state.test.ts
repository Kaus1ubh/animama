import { describe, expect, it } from "vitest";

import { resolveChatInputSubmitState } from "@animama/product-ui/components";

const baseState = {
  hasText: false,
  loading: false,
  hasStopHandler: false,
  isVoiceModeActive: false,
  disabled: false,
};

describe("chat input submit state", () => {
  it("disables optional Voice Mode without disabling text chat or stopping a reply", () => {
    const options = {
      ...baseState,
      submitMode: "text-or-voice" as const,
      voiceAvailable: false,
    };
    expect(resolveChatInputSubmitState(options)).toMatchObject({
      action: "start-voice",
      disabled: true,
    });
    expect(
      resolveChatInputSubmitState({ ...options, hasText: true }),
    ).toMatchObject({ action: "submit", disabled: false });
    expect(
      resolveChatInputSubmitState({
        ...options,
        loading: true,
        hasStopHandler: true,
      }),
    ).toMatchObject({ action: "stop-request", disabled: false });
  });
  it("renders an empty text-only composer as a disabled send action", () => {
    expect(
      resolveChatInputSubmitState({
        ...baseState,
        submitMode: "text-only",
      }),
    ).toMatchObject({
      action: null,
      disabled: true,
      icon: "send",
    });
  });

  it("enables only submit when a text-only composer has text", () => {
    expect(
      resolveChatInputSubmitState({
        ...baseState,
        submitMode: "text-only",
        hasText: true,
      }),
    ).toMatchObject({
      action: "submit",
      disabled: false,
      icon: "send",
    });
  });

  it("respects an external text-only disable and shows loading as a spinner", () => {
    expect(
      resolveChatInputSubmitState({
        ...baseState,
        submitMode: "text-only",
        hasText: true,
        disabled: true,
      }),
    ).toMatchObject({ action: "submit", disabled: true, icon: "send" });

    expect(
      resolveChatInputSubmitState({
        ...baseState,
        submitMode: "text-only",
        hasText: true,
        loading: true,
        hasStopHandler: true,
        isVoiceModeActive: true,
      }),
    ).toMatchObject({ action: null, disabled: true, icon: "loading" });
  });

  it("preserves text-or-voice submit, voice, and stop actions", () => {
    expect(
      resolveChatInputSubmitState({
        ...baseState,
        submitMode: "text-or-voice",
      }),
    ).toMatchObject({ action: "start-voice", icon: "voice" });

    expect(
      resolveChatInputSubmitState({
        ...baseState,
        submitMode: "text-or-voice",
        hasText: true,
      }),
    ).toMatchObject({ action: "submit", icon: "send" });

    expect(
      resolveChatInputSubmitState({
        ...baseState,
        submitMode: "text-or-voice",
        isVoiceModeActive: true,
      }),
    ).toMatchObject({ action: "stop-voice", icon: "stop" });

    expect(
      resolveChatInputSubmitState({
        ...baseState,
        submitMode: "text-or-voice",
        loading: true,
        hasStopHandler: true,
      }),
    ).toMatchObject({ action: "stop-request", icon: "stop" });
  });

  it("keeps the default no-stop loading behavior unchanged", () => {
    expect(
      resolveChatInputSubmitState({
        ...baseState,
        submitMode: "text-or-voice",
        loading: true,
      }),
    ).toMatchObject({ action: "start-voice", icon: "voice" });
  });
  it("names the Voice Mode shortcut in the start and stop tooltips", () => {
    const options = {
      ...baseState,
      submitMode: "text-or-voice" as const,
      voiceModeShortcut: "⌃⌥`",
    };
    expect(resolveChatInputSubmitState(options)).toMatchObject({
      tooltip: "Voice mode",
      tooltipShortcut: "⌃⌥`",
    });
    expect(
      resolveChatInputSubmitState({ ...options, isVoiceModeActive: true }),
    ).toMatchObject({ tooltip: "Stop voice mode", tooltipShortcut: "⌃⌥`" });
    // An unavailable control explains why instead of offering the shortcut.
    expect(
      resolveChatInputSubmitState({ ...options, voiceAvailable: false }),
    ).toMatchObject({
      tooltip: "Offline speech recognition is unavailable",
      tooltipShortcut: null,
    });
  });

  describe("while attachments hold a typed message", () => {
    it.each(["text-or-voice", "text-only"] as const)(
      "shows that %s sending waits for files and does not send",
      (submitMode) => {
        expect(
          resolveChatInputSubmitState({
            ...baseState,
            submitMode,
            hasText: true,
            attachmentHold: "waiting",
          }),
        ).toEqual({
          action: null,
          disabled: false,
          held: true,
          icon: "loading",
          label: "Waiting for files to be ready",
          tooltip: "Waiting for files to be ready",
        });
      },
    );

    it("asks for unreadable files to be removed", () => {
      expect(
        resolveChatInputSubmitState({
          ...baseState,
          submitMode: "text-or-voice",
          hasText: true,
          attachmentHold: "blocked",
        }),
      ).toEqual({
        action: null,
        disabled: false,
        held: true,
        icon: "send",
        label: "Remove unreadable files to send",
        tooltip: "Remove unreadable files to send",
      });
    });

    it("keeps an external disable", () => {
      expect(
        resolveChatInputSubmitState({
          ...baseState,
          submitMode: "text-or-voice",
          hasText: true,
          disabled: true,
          attachmentHold: "waiting",
        }),
      ).toMatchObject({ action: null, disabled: true, held: true });
    });

    it("still stops a reply or Voice Mode, and starts Voice Mode", () => {
      const held = {
        ...baseState,
        submitMode: "text-or-voice" as const,
        attachmentHold: "waiting" as const,
      };
      expect(
        resolveChatInputSubmitState({
          ...held,
          hasText: true,
          loading: true,
          hasStopHandler: true,
        }),
      ).toMatchObject({ action: "stop-request", disabled: false });
      expect(
        resolveChatInputSubmitState({ ...held, isVoiceModeActive: true }),
      ).toMatchObject({ action: "stop-voice", disabled: false });
      expect(resolveChatInputSubmitState(held)).toMatchObject({
        action: "start-voice",
        disabled: false,
      });
      expect(resolveChatInputSubmitState(held).held ?? false).toBe(false);
    });

    it("offers to stop Voice Mode while its held words cannot be sent", () => {
      // A held Voice Mode turn keeps its words in the composer, and the
      // microphone control only mutes, so this control must still stop it.
      expect(
        resolveChatInputSubmitState({
          ...baseState,
          submitMode: "text-or-voice",
          hasText: true,
          isVoiceModeActive: true,
          attachmentHold: "blocked",
        }),
      ).toMatchObject({ action: "stop-voice", icon: "stop", disabled: false });
    });

    it("sends normally once nothing holds the message", () => {
      expect(
        resolveChatInputSubmitState({
          ...baseState,
          submitMode: "text-or-voice",
          hasText: true,
          attachmentHold: "none",
        }),
      ).toMatchObject({ action: "submit", disabled: false, icon: "send" });
    });
  });
});
