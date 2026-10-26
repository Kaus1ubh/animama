import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

export type DesktopShortcutAction =
  | "press_to_talk"
  | "quick_chat"
  | "toggle_dictation"
  | "toggle_voice_mode"
  | "toggle_voice_mute"
  | "skip_tts";

export type DesktopKeyboardShortcut = {
  type?: "keyboard";
  code: string;
  key?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
};

export type DesktopMouseShortcut = {
  type: "mouse";
  button: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
};

export type DesktopShortcut = DesktopKeyboardShortcut | DesktopMouseShortcut;

export type DesktopShortcutMap = Record<DesktopShortcutAction, DesktopShortcut>;

/**
 * Default shortcuts per OS: a modifier plus one key each. Global one-shot
 * shortcuts are taken from every other app, so they avoid letters (shell and
 * text-editing commands) and keys the OS or its input methods use. macOS uses
 * Control, since Option with punctuation types characters (… æ ‘); Windows and
 * Linux use Alt, since Control with `.` and Space toggles CJK input methods and
 * Control with `;` `'` `]` are Office commands.
 */
const MACOS_DESKTOP_SHORTCUTS: DesktopShortcutMap = {
  press_to_talk: { code: "Backquote", key: "`", ctrlKey: true },
  quick_chat: { code: "Space", altKey: true },
  toggle_dictation: { code: "Period", key: ".", ctrlKey: true },
  toggle_voice_mode: { code: "Semicolon", key: ";", ctrlKey: true },
  toggle_voice_mute: { code: "Quote", key: "'", ctrlKey: true },
  skip_tts: { code: "BracketRight", key: "]", ctrlKey: true },
};

const OTHER_DESKTOP_SHORTCUTS: DesktopShortcutMap = {
  press_to_talk: { code: "Backquote", key: "`", ctrlKey: true },
  quick_chat: { code: "Space", altKey: true },
  toggle_dictation: { code: "Period", key: ".", altKey: true },
  toggle_voice_mode: { code: "Semicolon", key: ";", altKey: true },
  toggle_voice_mute: { code: "Quote", key: "'", altKey: true },
  skip_tts: { code: "BracketRight", key: "]", altKey: true },
};

/** The default shortcuts for `os` (Node's `process.platform` name). */
export function defaultDesktopShortcuts(os: string | null): DesktopShortcutMap {
  return os === "darwin" ? MACOS_DESKTOP_SHORTCUTS : OTHER_DESKTOP_SHORTCUTS;
}

const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);

const SUPPORTED_ACCELERATOR_CODES = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backquote",
  "Backslash",
  "Backspace",
  "BracketLeft",
  "BracketRight",
  "Comma",
  "Delete",
  "End",
  "Enter",
  "Equal",
  "Escape",
  "Home",
  "Insert",
  "Minus",
  "NumpadEnter",
  "PageDown",
  "PageUp",
  "Period",
  "Quote",
  "Semicolon",
  "Slash",
  "Space",
  "Tab",
]);

/**
 * Why a shortcut cannot be saved. The settings UI words each reason; `in_use`
 * names the action that already has the shortcut.
 */
export type DesktopShortcutIssue =
  | {
      reason:
        | "non_modifier_key_required"
        | "modifier_required"
        | "unsupported_key"
        | "unsupported_mouse_button"
        | "mouse_press_to_talk_only";
    }
  | { reason: "in_use"; action: DesktopShortcutAction };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return value === true ? true : undefined;
}

function isMouseShortcut(
  shortcut: DesktopShortcut,
): shortcut is DesktopMouseShortcut {
  return shortcut.type === "mouse";
}

function hasShortcutModifier(shortcut: DesktopShortcut): boolean {
  return (
    shortcut.ctrlKey === true ||
    shortcut.altKey === true ||
    shortcut.shiftKey === true ||
    shortcut.metaKey === true
  );
}

function isSupportedAcceleratorCode(code: string): boolean {
  if (/^Key[A-Z]$/.test(code)) return true;
  if (/^Digit[0-9]$/.test(code)) return true;
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return true;
  return SUPPORTED_ACCELERATOR_CODES.has(code);
}

function validateDesktopKeyboardShortcutShape(
  shortcut: DesktopKeyboardShortcut,
): DesktopShortcutIssue | null {
  if (!shortcut.code || MODIFIER_CODES.has(shortcut.code)) {
    return { reason: "non_modifier_key_required" };
  }
  if (!hasShortcutModifier(shortcut)) {
    return { reason: "modifier_required" };
  }
  if (!isSupportedAcceleratorCode(shortcut.code)) {
    return { reason: "unsupported_key" };
  }
  return null;
}

function validateDesktopMouseShortcutShape(
  shortcut: DesktopMouseShortcut,
): DesktopShortcutIssue | null {
  if (
    !Number.isSafeInteger(shortcut.button) ||
    shortcut.button <= 0 ||
    shortcut.button > 32
  ) {
    return { reason: "unsupported_mouse_button" };
  }
  return null;
}

function validateDesktopShortcutShape(
  action: DesktopShortcutAction,
  shortcut: DesktopShortcut,
): DesktopShortcutIssue | null {
  if (isMouseShortcut(shortcut)) {
    if (action !== "press_to_talk") {
      return { reason: "mouse_press_to_talk_only" };
    }
    return validateDesktopMouseShortcutShape(shortcut);
  }
  return validateDesktopKeyboardShortcutShape(shortcut);
}

function normalizeMouseButton(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 32
    ? value
    : null;
}

export function normalizeDesktopShortcut(
  value: unknown,
  fallback: DesktopShortcut,
  action: DesktopShortcutAction,
): DesktopShortcut {
  if (isRecord(value) && value.type === "mouse") {
    const button = normalizeMouseButton(value.button);
    if (button === null) return fallback;
    const shortcut: DesktopMouseShortcut = {
      type: "mouse",
      button,
      ...(normalizeBoolean(value.ctrlKey) ? { ctrlKey: true } : {}),
      ...(normalizeBoolean(value.altKey) ? { altKey: true } : {}),
      ...(normalizeBoolean(value.shiftKey) ? { shiftKey: true } : {}),
      ...(normalizeBoolean(value.metaKey) ? { metaKey: true } : {}),
    };
    return validateDesktopShortcutShape(action, shortcut) ? fallback : shortcut;
  }

  if (!isRecord(value) || typeof value.code !== "string") {
    return fallback;
  }
  const code = value.code.trim();
  const shortcut: DesktopKeyboardShortcut = {
    code,
    ...(typeof value.key === "string" && value.key ? { key: value.key } : {}),
    ...(normalizeBoolean(value.ctrlKey) ? { ctrlKey: true } : {}),
    ...(normalizeBoolean(value.altKey) ? { altKey: true } : {}),
    ...(normalizeBoolean(value.shiftKey) ? { shiftKey: true } : {}),
    ...(normalizeBoolean(value.metaKey) ? { metaKey: true } : {}),
  };
  return validateDesktopShortcutShape(action, shortcut) ? fallback : shortcut;
}

/** Stored shortcuts with each missing or invalid one replaced by the OS default. */
export function resolveDesktopShortcuts(
  value: unknown,
  os: string | null,
): DesktopShortcutMap {
  const source = isRecord(value) ? value : {};
  const defaults = defaultDesktopShortcuts(os);
  const resolve = (action: DesktopShortcutAction) =>
    normalizeDesktopShortcut(source[action], defaults[action], action);
  return {
    press_to_talk: resolve("press_to_talk"),
    quick_chat: resolve("quick_chat"),
    toggle_dictation: resolve("toggle_dictation"),
    toggle_voice_mode: resolve("toggle_voice_mode"),
    toggle_voice_mute: resolve("toggle_voice_mute"),
    skip_tts: resolve("skip_tts"),
  };
}

export function shortcutFromKeyboardEvent(
  event: KeyboardEvent | ReactKeyboardEvent,
): DesktopKeyboardShortcut | null {
  if (!event.code || MODIFIER_CODES.has(event.code)) {
    return null;
  }
  return {
    code: event.code,
    key: event.key.length === 1 ? event.key : undefined,
    ...(event.ctrlKey ? { ctrlKey: true } : {}),
    ...(event.altKey ? { altKey: true } : {}),
    ...(event.shiftKey ? { shiftKey: true } : {}),
    ...(event.metaKey ? { metaKey: true } : {}),
  };
}

export function shortcutFromMouseEvent(
  event: MouseEvent | ReactMouseEvent,
): DesktopMouseShortcut | null {
  if (!Number.isSafeInteger(event.button) || event.button < 0) {
    return null;
  }
  return {
    type: "mouse",
    button: event.button + 1,
    ...(event.ctrlKey ? { ctrlKey: true } : {}),
    ...(event.altKey ? { altKey: true } : {}),
    ...(event.shiftKey ? { shiftKey: true } : {}),
    ...(event.metaKey ? { metaKey: true } : {}),
  };
}

function shortcutSignature(shortcut: DesktopShortcut): string {
  const modifiers = [
    shortcut.ctrlKey === true ? "Ctrl" : "",
    shortcut.altKey === true ? "Alt" : "",
    shortcut.shiftKey === true ? "Shift" : "",
    shortcut.metaKey === true ? "Meta" : "",
  ]
    .filter(Boolean)
    .join("+");

  if (isMouseShortcut(shortcut)) {
    return ["mouse", modifiers, shortcut.button].filter(Boolean).join("+");
  }

  return [
    "keyboard",
    shortcut.ctrlKey === true ? "Ctrl" : "",
    shortcut.altKey === true ? "Alt" : "",
    shortcut.shiftKey === true ? "Shift" : "",
    shortcut.metaKey === true ? "Meta" : "",
    shortcut.code,
  ]
    .filter(Boolean)
    .join("+");
}

export function desktopShortcutsEquivalent(
  left: DesktopShortcut,
  right: DesktopShortcut,
): boolean {
  return shortcutSignature(left) === shortcutSignature(right);
}

/** The first reason `shortcut` cannot be saved for `action`, or null when it can. */
export function validateDesktopShortcut(
  action: DesktopShortcutAction,
  shortcut: DesktopShortcut,
  shortcuts: DesktopShortcutMap,
): DesktopShortcutIssue | null {
  const shapeError = validateDesktopShortcutShape(action, shortcut);
  if (shapeError) return shapeError;

  for (const [otherAction, otherShortcut] of Object.entries(shortcuts) as Array<
    [DesktopShortcutAction, DesktopShortcut]
  >) {
    if (otherAction === action) continue;
    if (desktopShortcutsEquivalent(shortcut, otherShortcut)) {
      return { reason: "in_use", action: otherAction };
    }
  }

  return null;
}

function codeLabel(code: string, key?: string): string {
  if (code === "Backquote") return "`";
  if (code === "Space") return "Space";
  if (code === "NumpadEnter") return "Numpad Enter";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Numpad ${code.slice(6)}`;
  if (key && key.length === 1) return key.toUpperCase();
  return code.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** macOS key glyphs for the non-letter keys a shortcut may use. */
const APPLE_KEY_GLYPHS: Record<string, string> = {
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  Backspace: "⌫",
  Delete: "⌦",
  End: "↘",
  Enter: "↩",
  Escape: "⎋",
  Home: "↖",
  NumpadEnter: "⌤",
  PageDown: "⇟",
  PageUp: "⇞",
  Tab: "⇥",
};

/** Arrow keys read as arrows on every platform. */
const ARROW_GLYPHS: Record<string, string> = {
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
};

/** A shortcut's modifiers as its OS writes them, in that OS's order. */
function modifierLabels(shortcut: DesktopShortcut, os: string | null): string[] {
  const held = (flag: boolean | undefined, label: string) =>
    flag === true ? [label] : [];
  return os === "darwin"
    ? [
        ...held(shortcut.ctrlKey, "⌃"),
        ...held(shortcut.altKey, "⌥"),
        ...held(shortcut.shiftKey, "⇧"),
        ...held(shortcut.metaKey, "⌘"),
      ]
    : [
        ...held(shortcut.ctrlKey, "Ctrl"),
        ...held(shortcut.altKey, "Alt"),
        ...held(shortcut.shiftKey, "Shift"),
        ...held(shortcut.metaKey, os === "win32" ? "Win" : "Super"),
      ];
}

/**
 * Keycap text for a keyboard shortcut, written the way its OS shows them:
 * "⌃." on macOS, "Alt+." elsewhere (as the creator history does).
 */
export function formatDesktopShortcutKeycap(
  shortcut: DesktopKeyboardShortcut,
  os: string | null,
): string {
  const key =
    (os === "darwin" ? APPLE_KEY_GLYPHS : ARROW_GLYPHS)[shortcut.code] ??
    codeLabel(shortcut.code, shortcut.key);
  const modifiers = modifierLabels(shortcut, os);
  return os === "darwin"
    ? [...modifiers, key].join("")
    : [...modifiers, key].join("+");
}

/**
 * Display text for any shortcut in its OS's style. The caller words the mouse
 * button (for example "Mouse Button 4") in the UI Locale.
 */
export function formatDesktopShortcut(
  shortcut: DesktopShortcut,
  os: string | null,
  mouseButtonLabel: (button: number) => string,
): string {
  if (!isMouseShortcut(shortcut)) {
    return formatDesktopShortcutKeycap(shortcut, os);
  }
  const modifiers = modifierLabels(shortcut, os);
  const button = mouseButtonLabel(shortcut.button);
  return os === "darwin"
    ? [modifiers.join(""), button].filter(Boolean).join(" ")
    : [...modifiers, button].join("+");
}

/**
 * Keycap text of the shortcuts the chat names in its tooltips: the composer's
 * microphone controls and the reply's skip-speech button. These actions
 * accept keyboard shortcuts only, so a mouse binding names nothing.
 */
export function desktopChatShortcutLabels(
  value: unknown,
  os: string | null,
): {
  dictation: string | null;
  voiceMode: string | null;
  voiceMute: string | null;
  skipTts: string | null;
} {
  const shortcuts = resolveDesktopShortcuts(value, os);
  const format = (shortcut: DesktopShortcut) =>
    isMouseShortcut(shortcut)
      ? null
      : formatDesktopShortcutKeycap(shortcut, os);
  return {
    dictation: format(shortcuts.toggle_dictation),
    voiceMode: format(shortcuts.toggle_voice_mode),
    voiceMute: format(shortcuts.toggle_voice_mute),
    skipTts: format(shortcuts.skip_tts),
  };
}
