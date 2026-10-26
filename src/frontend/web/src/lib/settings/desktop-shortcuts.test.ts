import { describe, expect, it } from "vitest";

import {
  defaultDesktopShortcuts,
  desktopChatShortcutLabels,
  formatDesktopShortcut,
  resolveDesktopShortcuts,
  validateDesktopShortcut,
  type DesktopShortcutAction,
} from "./desktop-shortcuts";

const MACOS_DEFAULTS = defaultDesktopShortcuts("darwin");

describe("validateDesktopShortcut", () => {
  const validate = (
    action: Parameters<typeof validateDesktopShortcut>[0],
    shortcut: Parameters<typeof validateDesktopShortcut>[1],
  ) => validateDesktopShortcut(action, shortcut, MACOS_DEFAULTS);

  it("accepts a free modified key", () => {
    expect(
      validate("quick_chat", { code: "KeyK", key: "k", ctrlKey: true }),
    ).toBeNull();
  });

  it("reports why a shortcut is refused as a reason code", () => {
    expect(
      validate("quick_chat", {
        code: "ShiftLeft",
        key: "Shift",
        ctrlKey: true,
      }),
    ).toEqual({ reason: "non_modifier_key_required" });
    expect(validate("quick_chat", { code: "KeyK", key: "k" })).toEqual({
      reason: "modifier_required",
    });
    expect(
      validate("quick_chat", { code: "Pause", key: "Pause", ctrlKey: true }),
    ).toEqual({ reason: "unsupported_key" });
    expect(validate("quick_chat", { type: "mouse", button: 4 })).toEqual({
      reason: "mouse_press_to_talk_only",
    });
    expect(validate("press_to_talk", { type: "mouse", button: 40 })).toEqual({
      reason: "unsupported_mouse_button",
    });
  });

  it("names the action that already uses the shortcut", () => {
    expect(validate("quick_chat", MACOS_DEFAULTS.press_to_talk)).toEqual({
      reason: "in_use",
      action: "press_to_talk",
    });
  });
});

describe("default desktop shortcuts", () => {
  const actions = Object.keys(MACOS_DEFAULTS) as DesktopShortcutAction[];

  it("uses one modifier and one key, Control on macOS and Alt elsewhere", () => {
    const keycaps = (os: string) =>
      Object.fromEntries(
        actions.map((action) => [
          action,
          formatDesktopShortcut(
            defaultDesktopShortcuts(os)[action],
            os,
            String,
          ),
        ]),
      );
    expect(keycaps("darwin")).toEqual({
      press_to_talk: "⌃`",
      quick_chat: "⌥Space",
      toggle_dictation: "⌃.",
      toggle_voice_mode: "⌃;",
      toggle_voice_mute: "⌃'",
      skip_tts: "⌃]",
    });
    expect(keycaps("win32")).toEqual({
      press_to_talk: "Ctrl+`",
      quick_chat: "Alt+Space",
      toggle_dictation: "Alt+.",
      toggle_voice_mode: "Alt+;",
      toggle_voice_mute: "Alt+'",
      skip_tts: "Alt+]",
    });
  });

  it("are valid and distinct on every OS", () => {
    for (const os of ["darwin", "win32", "linux"]) {
      const defaults = defaultDesktopShortcuts(os);
      for (const action of actions) {
        expect(
          validateDesktopShortcut(action, defaults[action], defaults),
        ).toBeNull();
      }
    }
  });

  it("fill in for stored maps that omit or break a shortcut", () => {
    // Preferences saved before the Dictate shortcut existed omit it.
    const resolved = resolveDesktopShortcuts(
      {
        quick_chat: { code: "KeyQ", ctrlKey: true },
        skip_tts: { code: "KeyS" },
      },
      "win32",
    );
    expect(resolved.quick_chat).toEqual({ code: "KeyQ", ctrlKey: true });
    expect(resolved.toggle_dictation).toEqual(
      defaultDesktopShortcuts("win32").toggle_dictation,
    );
    expect(resolved.skip_tts).toEqual(
      defaultDesktopShortcuts("win32").skip_tts,
    );
  });

  it("keep the Dictate shortcut keyboard-only", () => {
    expect(
      validateDesktopShortcut(
        "toggle_dictation",
        { type: "mouse", button: 4 },
        MACOS_DEFAULTS,
      ),
    ).toEqual({ reason: "mouse_press_to_talk_only" });
  });
});

describe("chat shortcut keycaps", () => {
  it("follows a rebinding in the OS's style", () => {
    const preferences = {
      toggle_dictation: {
        code: "KeyJ",
        key: "j",
        shiftKey: true,
        metaKey: true,
      },
    };
    expect(desktopChatShortcutLabels(preferences, "darwin")).toEqual({
      dictation: "⇧⌘J",
      voiceMode: "⌃;",
      voiceMute: "⌃'",
      skipTts: "⌃]",
    });
    expect(desktopChatShortcutLabels(preferences, "win32").dictation).toBe(
      "Shift+Win+J",
    );
  });

  it("writes a mouse Press to talk with the OS's modifiers", () => {
    const mouse = { type: "mouse" as const, button: 4, ctrlKey: true };
    const label = (button: number) => `Mouse Button ${button}`;
    expect(formatDesktopShortcut(mouse, "darwin", label)).toBe(
      "⌃ Mouse Button 4",
    );
    expect(formatDesktopShortcut(mouse, "win32", label)).toBe(
      "Ctrl+Mouse Button 4",
    );
  });
});
