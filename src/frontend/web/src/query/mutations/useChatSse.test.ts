import { describe, expect, it } from "vitest";

import { isChatMemoryUpdated, parseMemoryCue } from "@animama/product-ui/chat";
import { isRuntimeRemountRequired } from "@/lib/runtime-content/errors";
import { ChatSseHttpError, matchesRuntimeContentRevision } from "./useChatSse";

describe("chat runtime Asset revision fencing", () => {
  it("accepts only the mounted revision when a chat request is fenced", () => {
    expect(matchesRuntimeContentRevision("ar1-mounted", "ar1-mounted")).toBe(
      true,
    );
    expect(matchesRuntimeContentRevision("ar1-mounted", "ar1-stale")).toBe(
      false,
    );
    expect(matchesRuntimeContentRevision("ar1-mounted", null)).toBe(false);
  });

  it("rejects events when no frozen runtime revision is mounted", () => {
    expect(matchesRuntimeContentRevision(null, null)).toBe(false);
    expect(matchesRuntimeContentRevision(null, "tr1-any")).toBe(false);
  });

  it("preserves a pre-stream revision conflict for recovery", () => {
    const error = new ChatSseHttpError(409, "Conflict", {
      detail: {
        code: "runtime_remount_required",
      },
    });

    expect(error.status).toBe(409);
    expect(isRuntimeRemountRequired(error)).toBe(true);
  });
});

describe("memory.updated classification", () => {
  const frame = {
    type: "memory.updated",
    run_id: "run-1",
    message_id: 42,
    memory_cue: {
      episode: { text: "They start a new job on Monday." },
      memories: { entry_id: "mem-1", version: 4, excerpt: "- New job" },
    },
  };

  it("recognizes the event by type and parses its cue", () => {
    expect(isChatMemoryUpdated(frame)).toBe(true);
    expect(parseMemoryCue(frame.memory_cue)).toEqual(frame.memory_cue);
    // No top-level reply, error, emotion or gesture keys for shape guards to claim.
    for (const key of ["text", "error", "emotions", "gesture"]) {
      expect(key in frame).toBe(false);
    }
  });

  it("does not claim other typed events or untyped replies", () => {
    expect(isChatMemoryUpdated({ ...frame, type: "chat.title.updated" })).toBe(
      false,
    );
    expect(isChatMemoryUpdated({ text: "hello", run_id: "run-1" })).toBe(false);
    expect(isChatMemoryUpdated(null)).toBe(false);
  });

  it("accepts either part alone and drops cues with no valid part", () => {
    expect(
      parseMemoryCue({ episode: { text: "Note" }, memories: null }),
    ).toEqual({ episode: { text: "Note" }, memories: null });
    expect(
      parseMemoryCue({
        memories: { entry_id: "mem-1", version: 1, excerpt: "" },
      }),
    ).toEqual({
      episode: null,
      memories: { entry_id: "mem-1", version: 1, excerpt: "" },
    });
    expect(parseMemoryCue({ episode: null, memories: null })).toBeNull();
    expect(parseMemoryCue({ episode: { text: " " } })).toBeNull();
    expect(
      parseMemoryCue({
        memories: { entry_id: "", version: 1, excerpt: "x" },
      }),
    ).toBeNull();
    expect(
      parseMemoryCue({
        memories: { entry_id: "mem-1", version: 1.5, excerpt: "x" },
      }),
    ).toBeNull();
    expect(parseMemoryCue(undefined)).toBeNull();
  });
});
