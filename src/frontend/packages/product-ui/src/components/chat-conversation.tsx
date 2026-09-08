import { useEffect, type ComponentType } from "react";
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
import type { ChatMessage } from "../chat/useProductChatSession";
/** The ordinary chat transcript; hosts may supply shell-specific message positioning. */
export function ChatConversation({
  messages,
  isStreaming = false,
  completionPending = false,
  onQueueComplete,
  markdownEnabled = false,
  layout = "chat-only",
  messageComponent: Message = DefaultMessage,
}: {
  messages: readonly ChatMessage[];
  isStreaming?: boolean;
  completionPending?: boolean;
  onQueueComplete?: () => void;
  markdownEnabled?: boolean;
  layout?: MessageLayout;
  messageComponent?: ComponentType<MessageProps>;
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
      {messages.map((message) => (
        <Message from={message.role} key={message.id} messageLayout={layout}>
          <MessageContent
            animateOnEnter={message.animateOnEnter}
            from={message.role}
            messageLayout={layout}
          >
            {message.isPending ? (
              <MessageLoaderV2 />
            ) : markdownEnabled && message.role === "assistant" ? (
              <StreamdownResponse
                isAnimating={isStreaming && message.animateTextEffect === true}
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
          </MessageContent>
        </Message>
      ))}
    </div>
  );
}
