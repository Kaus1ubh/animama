import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  screen: {},
  session: {},
  shell: {},
  systemPreferences: {},
}));

import {
  isOwnerWindowCommand,
  type DesktopQuickChatRuntimeMessage,
} from "../src/main-process/quick-chat/quick-chat-window-manager.js";

function message(
  type: DesktopQuickChatRuntimeMessage["type"],
  payload: unknown,
): DesktopQuickChatRuntimeMessage {
  return { type, sequence: 1, sentAtMs: 0, animaId: "annie", payload };
}

describe("Quick Chat owner-window commands", () => {
  it("reveals the main window only for commands that continue there", () => {
    expect(
      isOwnerWindowCommand(
        message("command", { type: "open-memory-entry", entryId: "mem-1" }),
      ),
    ).toBe(true);
    for (const type of ["submit-text", "stop", "dismiss-crisis-card"]) {
      expect(isOwnerWindowCommand(message("command", { type }))).toBe(false);
    }
  });

  it("ignores other message types and malformed payloads", () => {
    expect(
      isOwnerWindowCommand(message("snapshot", { type: "open-memory-entry" })),
    ).toBe(false);
    expect(isOwnerWindowCommand(message("command", null))).toBe(false);
    expect(
      isOwnerWindowCommand(message("command", ["open-memory-entry"])),
    ).toBe(false);
  });
});
