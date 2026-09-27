import { describe, expect, it } from "vitest";

import type {
  PyMemoryManagerApproval,
  PyMemoryManagerMessage,
} from "@/lib/content/catalogTypes";
import {
  createEpisodeProcessingOptimisticSubmission,
  createMemoryManagerOptimisticSubmission,
  createReflectionOptimisticSubmission,
  MEMORY_MANAGER_MARKDOWN_ANIMATION,
  memoryManagerMarkdownAnimationDurationMs,
  newMemoryManagerAssistantMessage,
  projectMemoryManagerTranscript,
  restoreMemoryManagerComposer,
} from "./transcript-projection";

function approval(id: string): PyMemoryManagerApproval {
  return {
    id,
    run_id: "run-1",
    status: "pending",
    preview: {
      operation: "update",
      path: `${id}.md`,
      unified_diff: "",
    },
  };
}

function message(
  id: string,
  role: PyMemoryManagerMessage["role"],
  metadata: PyMemoryManagerMessage["metadata"] = {},
): PyMemoryManagerMessage {
  return {
    id,
    run_id: "run-1",
    role,
    content: `${role}:${id}`,
    metadata,
  };
}

describe("memory manager transcript projection", () => {
  it("preserves message order, normalizes system roles, and associates approvals", () => {
    const items = projectMemoryManagerTranscript({
      messages: [
        message("m1", "user"),
        message("m2", "system", {
          approval_ids: ["approval-2", "missing", "approval-1"],
        }),
      ],
      approvals: [
        approval("approval-1"),
        approval("approval-2"),
        approval("approval-unmatched"),
      ],
      optimisticSubmission: null,
    });

    expect(items.map((item) => item.key)).toEqual([
      "message:m1",
      "message:m2",
      "approval:unmatched:approval-unmatched",
    ]);
    expect(items[1]).toMatchObject({
      kind: "message",
      message: {
        role: "assistant",
        animateOnEnter: false,
      },
      approvals: [{ id: "approval-2" }, { id: "approval-1" }],
    });
  });

  it("appends an animated optimistic user message followed by a loader", () => {
    const messages = [message("m1", "assistant")];
    const optimisticSubmission = createMemoryManagerOptimisticSubmission(
      "Update profile.md",
      messages,
    );
    const items = projectMemoryManagerTranscript({
      messages,
      approvals: [approval("legacy-unmatched")],
      optimisticSubmission,
    });

    expect(items.map((item) => item.key)).toEqual([
      "message:m1",
      "approval:unmatched:legacy-unmatched",
      "message:optimistic-submission",
      "loader:optimistic-response",
    ]);
    expect(items[2]).toMatchObject({
      kind: "message",
      message: {
        role: "user",
        content: "Update profile.md",
        animateOnEnter: true,
        optimistic: true,
      },
    });
  });

  it("projects the fixed episode batch summary before processing responds", () => {
    const messages = [message("m1", "assistant")];
    const optimisticSubmission = createEpisodeProcessingOptimisticSubmission(
      73,
      messages,
    );
    const items = projectMemoryManagerTranscript({
      messages,
      approvals: [],
      optimisticSubmission,
    });

    expect(items.slice(-2)).toMatchObject([
      {
        kind: "message",
        message: {
          role: "user",
          content: "Process 50 pending episodes.",
          optimistic: true,
        },
      },
      { kind: "loader" },
    ]);
  });

  it("projects a Reflection request naming the Anima before it responds", () => {
    const messages = [message("m1", "assistant")];
    const optimisticSubmission = createReflectionOptimisticSubmission(
      "Annie",
      messages,
    );
    const items = projectMemoryManagerTranscript({
      messages,
      approvals: [],
      optimisticSubmission,
    });

    expect(items.slice(-2)).toMatchObject([
      {
        kind: "message",
        message: {
          role: "user",
          content: "Reflect on turns with Annie.",
          optimistic: true,
        },
      },
      { kind: "loader" },
    ]);
  });

  it("removes optimistic feedback as soon as a new message is durable", () => {
    const baseline = [message("m1", "assistant")];
    const optimisticSubmission = createMemoryManagerOptimisticSubmission(
      "Update profile.md",
      baseline,
    );
    const items = projectMemoryManagerTranscript({
      messages: [
        ...baseline,
        message("m2", "user"),
        message("m3", "assistant"),
      ],
      approvals: [],
      optimisticSubmission,
    });

    expect(items.map((item) => item.key)).toEqual([
      "message:m1",
      "message:m2",
      "message:m3",
    ]);
  });

  it("renders a specialized server-owned exchange without an optimistic duplicate", () => {
    const items = projectMemoryManagerTranscript({
      messages: [message("m1", "user"), message("m2", "assistant")],
      approvals: [],
      optimisticSubmission: null,
    });

    expect(items.map((item) => item.key)).toEqual(["message:m1", "message:m2"]);
    expect(
      items.filter(
        (item) => item.kind === "message" && item.message.role === "user",
      ),
    ).toHaveLength(1);
  });

  it("identifies the new assistant reply and sizes its reveal window", () => {
    const messages = [
      message("m1", "assistant"),
      message("m2", "user"),
      message("m3", "system"),
      message("m4", "assistant"),
    ];

    expect(newMemoryManagerAssistantMessage(messages, ["m1"])?.id).toBe("m4");
    expect(memoryManagerMarkdownAnimationDurationMs("one two three")).toBe(
      MEMORY_MANAGER_MARKDOWN_ANIMATION.duration +
        2 * MEMORY_MANAGER_MARKDOWN_ANIMATION.stagger,
    );
    expect(memoryManagerMarkdownAnimationDurationMs("   ")).toBe(0);
  });

  it("restores failed content only when there is no newer draft", () => {
    expect(restoreMemoryManagerComposer("", "Submitted text")).toBe(
      "Submitted text",
    );
    expect(restoreMemoryManagerComposer("Newer draft", "Submitted text")).toBe(
      "Newer draft",
    );
  });
});
