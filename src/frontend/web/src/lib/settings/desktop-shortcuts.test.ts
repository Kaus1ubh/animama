import { describe, expect, it } from "vitest";

import {
  DEFAULT_DESKTOP_SHORTCUTS,
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
