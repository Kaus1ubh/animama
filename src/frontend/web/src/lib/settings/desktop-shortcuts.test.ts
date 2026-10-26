import { describe, expect, it } from "vitest";

import {
  DEFAULT_DESKTOP_SHORTCUTS,
  desktopChatShortcutLabels,
  resolveDesktopShortcuts,
  validateDesktopShortcut,
} from "./desktop-shortcuts";

describe("validateDesktopShortcut", () => {
  const validate = (
    action: Parameters<typeof validateDesktopShortcut>[0],
    shortcut: Parameters<typeof validateDesktopShortcut>[1],
  ) => validateDesktopShortcut(action, shortcut, DEFAULT_DESKTOP_SHORTCUTS);

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
    expect(
      validate("quick_chat", DEFAULT_DESKTOP_SHORTCUTS.press_to_talk),
    ).toEqual({ reason: "in_use", action: "press_to_talk" });
  });
});

describe("desktop Dictate shortcut", () => {
  it("defaults to Ctrl + Alt + D and fills in for stored maps without it", () => {
    expect(DEFAULT_DESKTOP_SHORTCUTS.toggle_dictation).toMatchObject({
      code: "KeyD",
      ctrlKey: true,
      altKey: true,
    });
    // Preferences saved before the Dictate shortcut existed omit it.
    const resolved = resolveDesktopShortcuts({
      quick_chat: { code: "KeyQ", ctrlKey: true },
    });
    expect(resolved.toggle_dictation).toEqual(
      DEFAULT_DESKTOP_SHORTCUTS.toggle_dictation,
    );
    expect(resolved.quick_chat).toEqual({ code: "KeyQ", ctrlKey: true });
  });

  it("is keyboard-only and conflicts with the other actions", () => {
    expect(
      validateDesktopShortcut(
        "toggle_dictation",
        { type: "mouse", button: 4 },
        DEFAULT_DESKTOP_SHORTCUTS,
      ),
    ).toEqual({ reason: "mouse_press_to_talk_only" });
    expect(
      validateDesktopShortcut(
        "toggle_dictation",
        DEFAULT_DESKTOP_SHORTCUTS.quick_chat,
        DEFAULT_DESKTOP_SHORTCUTS,
      ),
    ).toEqual({ reason: "in_use", action: "quick_chat" });
  });
});

describe("chat shortcut keycaps", () => {
  it("writes shortcuts as macOS glyphs on macOS and as key names elsewhere", () => {
    expect(desktopChatShortcutLabels(undefined, "darwin")).toEqual({
      dictation: "⌃⌥D",
      voiceMode: "⌃⌥`",
      voiceMute: "⌃⇧`",
      skipTts: "⌃→",
    });
    expect(desktopChatShortcutLabels(undefined, "win32")).toEqual({
      dictation: "Ctrl+Alt+D",
      voiceMode: "Ctrl+Alt+`",
      voiceMute: "Ctrl+Shift+`",
      skipTts: "Ctrl+→",
    });
  });

  it("follows a rebinding", () => {
    const preferences = {
      toggle_dictation: { code: "KeyJ", key: "j", shiftKey: true, metaKey: true },
    };
    expect(desktopChatShortcutLabels(preferences, "darwin").dictation).toBe(
      "⇧⌘J",
    );
    expect(desktopChatShortcutLabels(preferences, "linux").dictation).toBe(
      "Shift+Meta+J",
    );
  });
});
