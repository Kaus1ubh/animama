// Adapted from ElevenLabs UI and Vercel AI Elements (MIT AND Apache-2.0): apps/www/registry/elevenlabs-ui/ui/conversation.tsx; modified for Animama.
// See licenses/third-party/adapted-code.md.
import type { ComponentProps } from "react";
import { useCallback } from "react";
import { ArrowDownIcon } from "lucide-react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

import { useProductTranslation } from "../i18n/product-translation";
import { cn } from "../lib/utils";
import { Button } from "./button";

export type ChatTranscriptProps = ComponentProps<typeof StickToBottom>;

export const ChatTranscript = ({
  className,
  ...props
}: ChatTranscriptProps) => (
  <StickToBottom
    className={cn("relative min-h-0 flex-1 overflow-y-auto", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

export type ChatTranscriptContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ChatTranscriptContent = ({
  className,
  ...props
}: ChatTranscriptContentProps) => (
  <StickToBottom.Content className={cn("p-4", className)} {...props} />
);

export type ChatTranscriptEmptyStateProps = Omit<
  ComponentProps<"div">,
  "title"
> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
};

export const ChatTranscriptEmptyState = ({
  className,
  title,
  description,
  icon,
  children,
  ...props
}: ChatTranscriptEmptyStateProps) => {
  const { t } = useProductTranslation();
  const shownDescription =
    description === undefined ? t("transcript.emptyDescription") : description;
  return (
    <div
      className={cn(
        "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          {icon && <div className="text-muted-foreground">{icon}</div>}
          <div className="space-y-1">
            <h3 className="text-sm font-medium">
              {title ?? t("transcript.emptyTitle")}
            </h3>
            {shownDescription && (
              <p className="text-muted-foreground text-sm">
                {shownDescription}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export type ChatTranscriptScrollButtonProps = ComponentProps<typeof Button>;

export const ChatTranscriptScrollButton = ({
  className,
  ...props
}: ChatTranscriptScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        className={cn(
          "bg-background dark:bg-background absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full shadow-md",
          className,
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};
