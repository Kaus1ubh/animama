import { describe, expect, it } from "vitest";

import {
  chatRunMessageId,
  mapServerMessagesForDisplay,
} from "./display-message-mapping";

describe("display message mapping", () => {
  it("expands one persisted structured assistant row into speech then display", () => {
    expect(
      mapServerMessagesForDisplay([
        {
          id: 123,
          chat_id: "chat-1",
          run_id: "run-1",
          role: "assistant",
          content: "Longer display details.",
          data: {
            structured: {
              speech: "Short spoken reply.",
              display: "Longer display details.",
            },
          },
        },
      ]),
    ).toEqual([
      {
        id: chatRunMessageId("run-1", "assistant"),
        role: "assistant",
        text: "Short spoken reply.",
      },
      {
        id: chatRunMessageId("run-1", "assistant", 1),
        role: "assistant",
        text: "Longer display details.",
      },
    ]);
  });

  it("suppresses display text that duplicates structured speech", () => {
    expect(
      mapServerMessagesForDisplay([
        {
          run_id: "run-1",
          role: "assistant",
          content: "Same answer.",
          data: {
            structured: {
              speech: " Same answer. ",
              display: "Same answer.",
            },
          },
        },
      ]),
    ).toEqual([
      {
        id: chatRunMessageId("run-1", "assistant"),
        role: "assistant",
        text: "Same answer.",
      },
    ]);
  });

  it("gives expanded structured messages stable unique ids without a run id", () => {
    expect(
      mapServerMessagesForDisplay([
        {
          id: 123,
          role: "assistant",
          content: "Display details.",
          data: {
            structured: {
              speech: "Spoken answer.",
              display: "Display details.",
            },
          },
        },
      ]).map((message) => message.id),
    ).toEqual(["msg-123", "msg-123-1"]);
  });

  it("uses run-stable ids for messages from the same streamed turn", () => {
    const messages = mapServerMessagesForDisplay([
      {
        chat_id: "chat-1",
        run_id: "run-1",
        role: "user",
        content: "Hello",
        created_at: "2026-07-05T12:00:00.000Z",
      },
      {
        chat_id: "chat-1",
        run_id: "run-1",
        role: "assistant",
        content: "Spoken answer.",
        created_at: "2026-07-05T12:00:01.000Z",
      },
      {
        chat_id: "chat-1",
        run_id: "run-1",
        role: "assistant",
        content: "Display details.",
        created_at: "2026-07-05T12:00:02.000Z",
      },
    ]);

    expect(messages.map((message) => message.id)).toEqual([
      chatRunMessageId("run-1", "user"),
      chatRunMessageId("run-1", "assistant"),
      chatRunMessageId("run-1", "assistant", 1),
    ]);
  });

  it("falls back to persisted ids for legacy messages without run ids", () => {
    expect(
      mapServerMessagesForDisplay([
        {
          id: 123,
          chat_id: "chat-1",
          role: "assistant",
          content: "Historical answer.",
        },
      ]),
    ).toEqual([
      {
        id: "msg-123",
        role: "assistant",
        text: "Historical answer.",
      },
    ]);
  });

  it("falls back to content when structured assistant data is unusable", () => {
    expect(
      mapServerMessagesForDisplay([
        {
          id: 123,
          role: "assistant",
          content: "Historical answer.",
          data: {
            structured: {
              speech: null,
              display: 42,
            },
          },
        },
      ]),
    ).toEqual([
      {
        id: "msg-123",
        role: "assistant",
        text: "Historical answer.",
      },
    ]);
  });

  it("puts a reply's memory cue only on the last bubble of its row", () => {
    const memoryCue = {
      episode: { text: "They adopted a cat named Miso." },
      memories: { entry_id: "mem-1", version: 3, excerpt: "- Miso the cat" },
    };
    const messages = mapServerMessagesForDisplay([
      {
        id: 10,
        run_id: "run-1",
        role: "user",
        content: "I adopted a cat!",
        memory_cue: null,
      },
      {
        id: 11,
        run_id: "run-1",
        role: "assistant",
        content: "Tell me everything.",
        data: {
          structured: {
            speech: "A cat!",
            display: "Tell me everything.",
          },
        },
        memory_cue: memoryCue,
      },
    ]);

    expect(messages.map((message) => message.memoryCue ?? null)).toEqual([
      null,
      null,
      memoryCue,
    ]);
  });

  it("keeps the cue on a single-bubble reply and ignores empty or malformed cues", () => {
    const [withCue, emptyCue, malformedCue] = mapServerMessagesForDisplay([
      {
        id: 1,
        role: "assistant",
        content: "Noted.",
        memory_cue: {
          episode: null,
          memories: { entry_id: "mem-1", version: 2, excerpt: "" },
        },
      },
      {
        id: 2,
        role: "assistant",
        content: "Nothing to remember.",
        memory_cue: { episode: null, memories: null },
      },
      {
        id: 3,
        role: "assistant",
        content: "Broken cue.",
        memory_cue: {
          episode: { text: "  " },
          memories: { entry_id: "mem-1", version: "2", excerpt: "x" },
        } as never,
      },
    ]);

    // A removal-only change has an empty excerpt but is still an update.
    expect(withCue.memoryCue).toEqual({
      episode: null,
      memories: { entry_id: "mem-1", version: 2, excerpt: "" },
    });
    expect(emptyCue).not.toHaveProperty("memoryCue");
    expect(malformedCue).not.toHaveProperty("memoryCue");
  });

  it("skips internal and empty messages", () => {
    expect(
      mapServerMessagesForDisplay([
        {
          run_id: "run-1",
          role: "assistant",
          content: "Hidden.",
          internal: true,
        },
        {
          run_id: "run-1",
          role: "assistant",
          content: "   ",
        },
      ]),
    ).toEqual([]);
  });
});
