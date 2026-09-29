import { ChatFailureNotice } from "./chat-failure-notice";
import { Fragment, useEffect, type ComponentType, type ReactNode } from "react";
import {
  Message as DefaultMessage,
  MessageContent,
  type MessageProps,
  type MessageLayout,
} from "./message";
import {
  Response as PlainTextResponse,
  StreamingResponse,
} from "./animated-text-response";
import { Response as StreamdownResponse } from "./streamdown-response";
import MessageLoaderV2 from "./message-loader-v2";
import { chatRunStatusLabel } from "../lib/chat/run-status";
import type { ChatMessage } from "../chat/useProductChatSession";
/** The ordinary chat transcript; hosts may supply shell-specific message positioning. */
export function ChatConversation({
  messages,
  isStreaming = false,
  completionPending = false,
  onQueueComplete,
  onRestoreMessage,
  restoreDisabled = false,
  markdownEnabled = false,
  layout = "chat-only",
  messageComponent: Message = DefaultMessage,
  renderAssistantAccessory,
}: {
  messages: readonly ChatMessage[];
  isStreaming?: boolean;
  completionPending?: boolean;
  onQueueComplete?: () => void;
  onRestoreMessage?: (text: string) => void;
  restoreDisabled?: boolean;
  markdownEnabled?: boolean;
  layout?: MessageLayout;
  messageComponent?: ComponentType<MessageProps>;
  /**
   * Host content shown at the foot of a settled assistant bubble, such as a
   * memory cue. The package owns no routes, so links and commands stay with
   * the host; return `null` for messages without an accessory.
   */
  renderAssistantAccessory?: (message: ChatMessage) => ReactNode;
}) {
  // Markdown renders its final response directly; only plain text has a queue to drain.
  useEffect(() => {
    if (markdownEnabled && completionPending) onQueueComplete?.();
  }, [markdownEnabled, completionPending, onQueueComplete]);

  return (
    <div
      className="animama-chat-conversation"
      role="log"
      aria-label="Conversation"
    >
      {" "}
      {messages.map((message) => {
        const accessory =
          message.role === "assistant" && !message.isPending
            ? renderAssistantAccessory?.(message)
            : null;
        return (
          <Fragment key={message.id}>
            <Message from={message.role} messageLayout={layout}>
              <MessageContent
                animateOnEnter={message.animateOnEnter}
                from={message.role}
                messageLayout={layout}
              >
                {message.isPending && message.pendingStatus ? (
                  <div className="flex items-center gap-2" role="status">
                    <MessageLoaderV2 />
                    <span className="text-sm">
                      {chatRunStatusLabel(message.pendingStatus)}
                    </span>
                  </div>
                ) : message.isPending ? (
                  <MessageLoaderV2 />
                ) : markdownEnabled && message.role === "assistant" ? (
                  <StreamdownResponse
                    isAnimating={
                      isStreaming && message.animateTextEffect === true
                    }
                  >
                    {message.text}
                  </StreamdownResponse>
                ) : message.animateTextEffect &&
                  message.role === "assistant" &&
                  message.streamingSegments?.length ? (
                  <StreamingResponse
                    completionPending={completionPending}
                    onQueueComplete={onQueueComplete}
                    segments={message.streamingSegments}
                  />
                ) : (
                  <PlainTextResponse>{message.text}</PlainTextResponse>
                )}
                {accessory ? (
                  <div className="mt-1 flex items-center">{accessory}</div>
                ) : null}
              </MessageContent>
            </Message>
            {message.failure && (
              <Message from="assistant" messageLayout={layout}>
                <ChatFailureNotice
                  failure={message.failure}
                  onRestoreMessage={onRestoreMessage}
                  restoreDisabled={isStreaming || restoreDisabled}
                />
              </Message>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
