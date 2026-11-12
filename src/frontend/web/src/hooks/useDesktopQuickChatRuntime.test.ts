import { describe, expect, it } from "vitest";

import {
  isQuickChatCommand,
  isQuickChatSnapshot,
} from "./useDesktopQuickChatRuntime";

const snapshot = {
  activeChat: null,
  animaId: "annie",
  attachmentHold: "none",
  chatId: "chat-1",
  input: "",
  inputPlaceholder: "",
  canChat: true,
  isStreaming: false,
  isAwaitingStreamingAnimationFinalization: false,
  displayMessages: [],
  promptSuggestions: [],
  showPromptSuggestions: false,
  voice: {},
};

describe("Quick Chat memory cue mirror", () => {
  it("accepts an open-memory-entry command only with a bounded entry id", () => {
    for (const entryId of [
      "mem-3f2b8c1e-7a4d-4b8e-9c1f-2d3e4f5a6b7c",
      "entry_1",
    ]) {
      expect(isQuickChatCommand({ type: "open-memory-entry", entryId })).toBe(
        true,
      );
    }
    for (const entryId of [
      undefined,
      42,
      "",
      "-mem",
      "../animas",
      "mem 1",
      "mem-1?tab=uploads",
      "mem/1",
      `m${"x".repeat(128)}`,
    ]) {
      expect(isQuickChatCommand({ type: "open-memory-entry", entryId })).toBe(
        false,
      );
    }
  });

  it("mirrors display messages with their memory cue and the Anima name", () => {
    const mirrored = structuredClone({
      ...snapshot,
      animaName: "Annie",
      displayMessages: [
        {
          id: "run-1-assistant",
          role: "assistant",
          text: "A cat!",
          memoryCue: {
            episode: { text: "They adopted a cat." },
            memories: { entry_id: "mem-1", version: 2, excerpt: "- Cat" },
          },
        },
      ],
    });
    expect(isQuickChatSnapshot(mirrored)).toBe(true);
    expect(mirrored.displayMessages[0].memoryCue.memories.entry_id).toBe(
      "mem-1",
    );
    expect(isQuickChatSnapshot({ ...snapshot, animaName: null })).toBe(true);
    expect(isQuickChatSnapshot({ ...snapshot, animaName: 7 })).toBe(false);
  });
});

describe("Quick Chat attachment hold", () => {
  it("mirrors the main window's attachment hold", () => {
    for (const attachmentHold of ["none", "waiting", "blocked"]) {
      expect(
        isQuickChatSnapshot(structuredClone({ ...snapshot, attachmentHold })),
      ).toBe(true);
    }
    // Both windows load the same bundle, so every snapshot carries the hold.
    const withoutHold: Record<string, unknown> = { ...snapshot };
    delete withoutHold.attachmentHold;
    expect(isQuickChatSnapshot(withoutHold)).toBe(false);
    for (const attachmentHold of [undefined, null, "held", true, 1]) {
      expect(isQuickChatSnapshot({ ...snapshot, attachmentHold })).toBe(false);
    }
  });
});

describe("Quick Chat speech playback", () => {
  it("accepts the skip-tts command from the Quick Chat window", () => {
    expect(isQuickChatCommand({ type: "skip-tts" })).toBe(true);
    expect(isQuickChatCommand({ type: "skip_tts" })).toBe(false);
  });
});
