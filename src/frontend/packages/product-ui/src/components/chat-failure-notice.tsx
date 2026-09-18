import type { ChatFailure } from "../chat/chat-failure";
import { Button } from "./button";

/** Keep recovery beside the affected turn, without displaying provider payloads. */
export function ChatFailureNotice({
  failure,
  onRestoreMessage,
  restoreDisabled = false,
}: {
  failure: ChatFailure;
  onRestoreMessage?: (text: string) => void;
  restoreDisabled?: boolean;
}) {
  return (
    <div className="border-destructive/40 bg-background text-foreground my-3 max-w-prose rounded-lg border p-4">
      <div role="alert">
        <p className="font-medium">{failure.title}</p>
        <p className="mt-1 text-sm">{failure.guidance}</p>
        {failure.retryAfterSeconds && (
          <p className="mt-1 text-sm">
            The provider recommends waiting at least {failure.retryAfterSeconds}{" "}
            seconds before another attempt.
          </p>
        )}
      </div>
      {failure.partialText && (
        <div className="mt-3 border-l-2 pl-3">
          <p className="text-sm font-medium">Incomplete reply</p>
          <p className="text-sm whitespace-pre-wrap">{failure.partialText}</p>
        </div>
      )}
      <p className="text-muted-foreground mt-2 text-sm">
        Completion wasn't confirmed. This notice and any partial reply are kept
        here until you leave this chat or reload.
      </p>
      {onRestoreMessage && (
        <>
          <Button
            className="mt-3"
            type="button"
            variant="outline"
            disabled={restoreDisabled}
            onClick={() => onRestoreMessage(failure.originalText)}
          >
            Restore message
          </Button>
          <p className="text-muted-foreground mt-1 text-xs">
            {restoreDisabled
              ? "Available when no reply is active and the composer is empty."
              : "Restores the text for editing. Nothing is sent automatically."}
          </p>
        </>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer">Details</summary>
        <p className="mt-1">
          Error code: <code>{failure.code}</code>
        </p>
      </details>
    </div>
  );
}
