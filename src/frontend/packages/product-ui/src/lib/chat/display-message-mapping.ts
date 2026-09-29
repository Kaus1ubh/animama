import type { ChatFailure } from "../../chat/chat-failure";
import type { PyChatMessage } from "@animama/runtime-contracts/api-types";
import { parseMemoryCue, type ChatMemoryCue } from "./memory-cue";
import type { ChatRunStatusKind } from "./run-status";

export type ChatDisplayMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
  failure?: ChatFailure;
  isPending?: boolean;
  /** Backend work shown while the bubble is pending, such as summarizing. */
  pendingStatus?: ChatRunStatusKind;
  animateOnEnter?: boolean;
  animateTextEffect?: boolean;
  streamingSegments?: string[];
  /** What the turn remembered; only on the last visible bubble of its reply. */
  memoryCue?: ChatMemoryCue;
};

export function chatRunMessageId(
  runId: string,
  role: "user" | "assistant",
  ordinal = 0,
): string {
  const base = `run-${runId}-${role}`;
  return ordinal > 0 ? `${base}-${ordinal}` : base;
}

export function mapServerMessagesForDisplay(
  messages: PyChatMessage[],
): ChatDisplayMessage[] {
  const messageIdCounts = new Map<string, number>();
  const displayMessages: ChatDisplayMessage[] = [];

  messages.forEach((message, index) => {
    if (message.internal) return;

    const role = message.role === "user" ? "user" : "assistant";
    const structuredTexts =
      role === "assistant" ? structuredAssistantTexts(message) : [];
    const rawContent = message.content ?? "";
    const texts = structuredTexts.length
      ? structuredTexts
      : rawContent.trim()
        ? [rawContent]
        : [];

    // One row may render as speech plus display bubbles; the cue follows the
    // reply, so it belongs on the last one, matching the live stream.
    const memoryCue =
      role === "assistant" ? parseMemoryCue(message.memory_cue) : null;
    texts.forEach((text, textIndex) => {
      displayMessages.push({
        id: serverMessageDisplayId(message, role, index, messageIdCounts),
        role,
        text,
        ...(message.created_at ? { createdAt: message.created_at } : {}),
        ...(memoryCue && textIndex === texts.length - 1 ? { memoryCue } : {}),
      });
    });
  });

  return displayMessages;
}

/**
 * Restores the live SSE speech/display projection from one provider-shaped
 * persisted assistant row. The history API keeps both values in
 * `data.structured`, while its legacy `content` projection prefers display.
 */
function structuredAssistantTexts(message: PyChatMessage): string[] {
  const structured = message.data?.structured;
  if (
    !structured ||
    typeof structured !== "object" ||
    Array.isArray(structured)
  ) {
    return [];
  }

  const structuredRecord = structured as Record<string, unknown>;
  const speechValue = structuredRecord.speech;
  const displayValue = structuredRecord.display;
  const speech = typeof speechValue === "string" ? speechValue.trim() : "";
  const display = typeof displayValue === "string" ? displayValue.trim() : "";
  const texts = speech ? [speech] : [];

  if (display && display !== speech) {
    texts.push(display);
  }

  return texts;
}

function serverMessageDisplayId(
  message: PyChatMessage,
  role: "user" | "assistant",
  index: number,
  messageIdCounts: Map<string, number>,
): string {
  const runId = typeof message.run_id === "string" ? message.run_id.trim() : "";
  if (runId) {
    const countKey = `${runId}:${role}`;
    const ordinal = messageIdCounts.get(countKey) ?? 0;
    messageIdCounts.set(countKey, ordinal + 1);
    return chatRunMessageId(runId, role, ordinal);
  }

  const idBase =
    message.id ?? message.created_at ?? message.chat_id ?? `${role}-${index}`;
  const base = `msg-${idBase}`;
  const countKey = `persisted:${base}`;
  const ordinal = messageIdCounts.get(countKey) ?? 0;
  messageIdCounts.set(countKey, ordinal + 1);
  return ordinal > 0 ? `${base}-${ordinal}` : base;
}
