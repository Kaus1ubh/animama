import { chatFailureCopy, type ChatFailure } from "../chat/chat-failure";
import { useProductTranslation } from "../i18n/product-translation";
import { safeNavigationUrl } from "../lib/safe-url";
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
  const { t } = useProductTranslation();
  // Only a safe link renders, even when a host built the failure itself.
  const linkHref = safeNavigationUrl(failure.link?.href);
  // Catalog copy follows the active locale; host-built failures show their text.
  const title = failure.copy
    ? chatFailureCopy(t, failure.copy.title)
    : failure.title;
  const guidance = failure.copy
    ? chatFailureCopy(t, failure.copy.guidance)
    : failure.guidance;
  const linkLabel = failure.copy?.linkLabel
    ? chatFailureCopy(t, failure.copy.linkLabel)
    : failure.link?.label;
  return (
    <div className="border-destructive/40 bg-background text-foreground my-3 max-w-prose rounded-lg border p-4">
      <div role="alert">
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm">{guidance}</p>
        {failure.retryAfterSeconds && (
          <p className="mt-1 text-sm">
            {t("chatFailure.notice.retryAfter", {
              count: failure.retryAfterSeconds,
            })}
          </p>
        )}
      </div>
      {failure.link && linkHref && (
        <Button asChild className="mt-3">
          <a href={linkHref} target="_blank" rel="noopener noreferrer">
            {linkLabel}
          </a>
        </Button>
      )}
      {failure.partialText && (
        <div className="mt-3 border-l-2 pl-3">
          <p className="text-sm font-medium">
            {t("chatFailure.notice.incompleteReply")}
          </p>
          <p className="text-sm whitespace-pre-wrap">{failure.partialText}</p>
        </div>
      )}
      <p className="text-muted-foreground mt-2 text-sm">
        {t("chatFailure.notice.notConfirmed")}
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
            {t("chatFailure.notice.restore")}
          </Button>
          <p className="text-muted-foreground mt-1 text-xs">
            {restoreDisabled
              ? t("chatFailure.notice.restoreDisabled")
              : t("chatFailure.notice.restoreHint")}
          </p>
        </>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer">
          {t("chatFailure.notice.details")}
        </summary>
        <p className="mt-1">
          {t("chatFailure.notice.errorCode")} <code>{failure.code}</code>
        </p>
      </details>
    </div>
  );
}
