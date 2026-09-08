import type {
  PyMemoryManagerApproval,
  PyMemoryManagerMessage,
} from "@/lib/content/catalogTypes";

export type MemoryManagerOptimisticSubmission = {
  content: string;
  baselineMessageIds: readonly string[];
};

export type MemoryManagerDisplayMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  animateOnEnter: boolean;
  optimistic: boolean;
};

/** Keep these explicit so the request-local expiry matches Streamdown's reveal. */
export const MEMORY_MANAGER_MARKDOWN_ANIMATION = {
  animation: "fadeIn",
  duration: 120,
  sep: "word",
  stagger: 20,
} as const;

export type MemoryManagerTranscriptItem =
  | {
      kind: "message";
      key: string;
      message: MemoryManagerDisplayMessage;
      approvals: PyMemoryManagerApproval[];
    }
  | {
      kind: "approval";
      key: string;
      approval: PyMemoryManagerApproval;
    }
  | {
      kind: "loader";
      key: string;
    };

function approvalIdsForMessage(message: PyMemoryManagerMessage) {
  const approvalIds = message.metadata?.approval_ids;
  if (!Array.isArray(approvalIds)) return [];
  return approvalIds.filter(
    (value): value is string => typeof value === "string",
  );
}

/** Captures the durable transcript boundary for one optimistic request. */
export function createMemoryManagerOptimisticSubmission(
  content: string,
  messages: readonly PyMemoryManagerMessage[],
): MemoryManagerOptimisticSubmission {
  return {
    content,
    baselineMessageIds: messages.map((message) => message.id),
  };
}

/** Mirrors the server-owned summary while a fixed episode batch is starting. */
export function createEpisodeProcessingOptimisticSubmission(
  pendingEpisodeCount: number,
  messages: readonly PyMemoryManagerMessage[],
): MemoryManagerOptimisticSubmission {
  const batchSize = Math.min(Math.max(Math.trunc(pendingEpisodeCount), 1), 50);
  return createMemoryManagerOptimisticSubmission(
    `Process ${batchSize} pending episodes.`,
    messages,
  );
}

/** Keeps a newer draft, otherwise restores the failed submitted request. */
export function restoreMemoryManagerComposer(
  currentComposer: string,
  submittedContent: string,
) {
  return currentComposer.trim() ? currentComposer : submittedContent;
}

/** Finds the durable assistant reply added after one manager submission began. */
export function newMemoryManagerAssistantMessage(
  messages: readonly PyMemoryManagerMessage[],
  baselineMessageIds: readonly string[],
) {
  const baselineIds = new Set(baselineMessageIds);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && !baselineIds.has(message.id)) {
      return message;
    }
  }
  return null;
}

/** Allows the last word's reveal to finish before its request-local marker clears. */
export function memoryManagerMarkdownAnimationDurationMs(content: string) {
  const wordCount = content.match(/\S+/g)?.length ?? 0;
  if (wordCount === 0) return 0;
  return (
    MEMORY_MANAGER_MARKDOWN_ANIMATION.duration +
    (wordCount - 1) * MEMORY_MANAGER_MARKDOWN_ANIMATION.stagger
  );
}

/** Projects durable messages, approvals, and request-local pending feedback. */
export function projectMemoryManagerTranscript({
  messages,
  approvals,
  optimisticSubmission,
}: {
  messages: readonly PyMemoryManagerMessage[];
  approvals: readonly PyMemoryManagerApproval[];
  optimisticSubmission: MemoryManagerOptimisticSubmission | null;
}): MemoryManagerTranscriptItem[] {
  const approvalsById = new Map(
    approvals.map((approval) => [approval.id, approval]),
  );
  const renderedApprovalIds = new Set<string>();
  const items: MemoryManagerTranscriptItem[] = messages.map((message) => {
    const messageApprovals = approvalIdsForMessage(message)
      .map((id) => approvalsById.get(id))
      .filter(
        (approval): approval is PyMemoryManagerApproval =>
          approval !== undefined,
      );
    for (const approval of messageApprovals) {
      renderedApprovalIds.add(approval.id);
    }

    return {
      kind: "message" as const,
      key: `message:${message.id}`,
      message: {
        id: message.id,
        role: message.role === "user" ? "user" : "assistant",
        content: message.content,
        animateOnEnter: false,
        optimistic: false,
      },
      approvals: messageApprovals,
    };
  });

  for (const approval of approvals) {
    if (renderedApprovalIds.has(approval.id)) continue;
    items.push({
      kind: "approval",
      key: `approval:unmatched:${approval.id}`,
      approval,
    });
  }

  if (!optimisticSubmission) return items;

  const baselineIds = new Set(optimisticSubmission.baselineMessageIds);
  const responseHasPersisted = messages.some(
    (message) => !baselineIds.has(message.id),
  );
  if (responseHasPersisted) return items;

  items.push(
    {
      kind: "message",
      key: "message:optimistic-submission",
      message: {
        id: "optimistic-submission",
        role: "user",
        content: optimisticSubmission.content,
        animateOnEnter: true,
        optimistic: true,
      },
      approvals: [],
    },
    {
      kind: "loader",
      key: "loader:optimistic-response",
    },
  );

  return items;
}
