import {
  AlertTriangle,
  Check,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Undo2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  PyMemoryManagerApproval,
  PyMemoryManagerRunResponse,
} from "@/lib/content/catalogTypes";
import {
  MEMORY_MANAGER_REJECTION_FEEDBACK_MAX_CHARS,
  validateMemoryManagerRejectionFeedback,
} from "@/lib/memory-manager/approval-feedback";
import {
  canShowMemoryManagerApprovalUndo,
  isAppliedMemoryManagerApproval,
  memoryManagerApprovalStatusLabel,
} from "@/lib/memory-manager/approval-undo";
import {
  MEMORY_MANAGER_MARKDOWN_ANIMATION,
  projectMemoryManagerTranscript,
  type MemoryManagerOptimisticSubmission,
  type MemoryManagerTranscriptItem,
} from "@/lib/memory-manager/transcript-projection";
import {
  episodeProcessingPresentation,
  reflectionPresentation,
} from "@/lib/memory-manager/workspace-state";
import { uncodedErrorText } from "@/lib/errors/apiError";
import { cn } from "@/lib/utils";
import { Response as PlainTextResponse } from "@/ui/components/animated-text-response";
import { Button } from "@/ui/components/button";
import {
  ChatInput,
  ChatInputSubmit,
  ChatInputTextArea,
} from "@/ui/components/chat-input";
import {
  ChatTranscript,
  ChatTranscriptContent,
  ChatTranscriptEmptyState,
  ChatTranscriptScrollButton,
} from "@/ui/components/chat-transcript";
import { Message, MessageContent } from "@/ui/components/message";
import MessageLoaderV2 from "@/ui/components/message-loader-v2";
import { Response as StreamdownResponse } from "@/ui/components/streamdown-response";
import { Textarea } from "@/ui/components/textarea";
import { managerPathLabel } from "@/lib/memory-entries/anima-folders";
import { useMemoryAnimaFolders } from "@/query/hooks/useMemoryEntries";
import { MemoryDiffViewer } from "@/ui/memory/MemoryDiffViewer";

type MemoryManagerChatPanelProps = {
  snapshot: PyMemoryManagerRunResponse | null;
  composer: string;
  optimisticSubmission: MemoryManagerOptimisticSubmission | null;
  animatingAssistantMessageId: string | null;
  isSending: boolean;
  isLoading: boolean;
  isError: boolean;
  isClosed: boolean;
  isBusy: boolean;
  hasPendingApproval: boolean;
  episodeProcessingComposerLocked: boolean;
  isDeciding: boolean;
  isUndoing: boolean;
  onComposerChange: (value: string) => void;
  onSubmit: () => void;
  onDecision: (
    approval: PyMemoryManagerApproval,
    decision: "approve" | "reject",
    feedback?: string,
  ) => void;
  onUndo: (approval: PyMemoryManagerApproval) => void;
  onRetry: () => void;
};

function parseMarkdownAsSingleBlock(markdown: string) {
  return [markdown];
}

function ApprovalCard({
  approval,
  isDeciding,
  isUndoing,
  onDecision,
  onUndo,
}: {
  approval: PyMemoryManagerApproval;
  isDeciding: boolean;
  isUndoing: boolean;
  onDecision: (
    approval: PyMemoryManagerApproval,
    decision: "approve" | "reject",
    feedback?: string,
  ) => void;
  onUndo: (approval: PyMemoryManagerApproval) => void;
}) {
  const { t } = useTranslation("memory");
  const pending = approval.status === "pending";
  const showUndo = canShowMemoryManagerApprovalUndo(approval, isUndoing);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  // Validated each render so its message follows the active UI Locale.
  const feedbackValidation = validateMemoryManagerRejectionFeedback(feedback);
  const feedbackErrorId = `approval-feedback-error-${approval.id}`;
  const animaFolders = useMemoryAnimaFolders();
  return (
    <div className="w-full min-w-0 space-y-3">
      <MemoryDiffViewer
        preview={approval.preview}
        pathLabel={managerPathLabel(approval.preview.path, animaFolders)}
        className="min-w-0"
      />
      {approval.decision_feedback ? (
        <div className="border-border/70 bg-muted/30 rounded-lg border px-3 py-2 text-sm">
          <p className="text-foreground font-medium">
            {t("manager.approval.rejectionFeedback")}
          </p>
          <p className="text-muted-foreground mt-1 whitespace-pre-wrap">
            {approval.decision_feedback}
          </p>
        </div>
      ) : null}
      {pending && feedbackOpen ? (
        <div className="border-border/70 bg-muted/20 space-y-2 rounded-lg border p-3">
          <label
            className="text-foreground text-sm font-medium"
            htmlFor={`approval-feedback-${approval.id}`}
          >
            {t("manager.approval.requestRevision")}
          </label>
          <Textarea
            id={`approval-feedback-${approval.id}`}
            aria-describedby={feedbackErrorId}
            aria-invalid={!feedbackValidation.valid}
            autoFocus
            className="min-h-24 resize-y"
            disabled={isDeciding}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder={t("manager.approval.feedbackPlaceholder")}
            value={feedback}
          />
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="text-xs">
              <p
                id={feedbackErrorId}
                className={cn(
                  feedbackValidation.valid
                    ? "text-muted-foreground"
                    : "text-destructive",
                )}
              >
                {feedbackValidation.valid
                  ? t("manager.approval.feedbackHint")
                  : feedbackValidation.error}
              </p>
              <p className="text-muted-foreground mt-1">
                {t("manager.approval.feedbackCount", {
                  length: feedback.length,
                  max: MEMORY_MANAGER_REJECTION_FEEDBACK_MAX_CHARS,
                })}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isDeciding}
                onClick={() => setFeedbackOpen(false)}
              >
                {t("shared.cancel")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isDeciding || !feedbackValidation.valid}
                onClick={() => {
                  if (!feedbackValidation.valid) return;
                  onDecision(approval, "reject", feedbackValidation.feedback);
                }}
              >
                {isDeciding ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <MessageSquareText className="size-4" />
                )}
                {t("manager.approval.sendFeedback")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium",
            approval.status === "approved" && "bg-success/10 text-success",
            approval.status === "rejected" &&
              "bg-rose-500/10 text-rose-700 dark:text-rose-300",
            pending && "bg-muted text-muted-foreground",
          )}
        >
          {memoryManagerApprovalStatusLabel(approval)}
        </span>
        <div className="flex flex-wrap gap-2">
          {pending ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isDeciding}
                onClick={() => onDecision(approval, "reject")}
              >
                {isDeciding ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <X className="size-4" />
                )}
                {t("manager.approval.reject")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isDeciding}
                onClick={() => setFeedbackOpen((current) => !current)}
              >
                <MessageSquareText className="size-4" />
                {t("manager.approval.requestChanges")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isDeciding}
                onClick={() => onDecision(approval, "approve")}
              >
                {isDeciding ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                {t("manager.approval.approve")}
              </Button>
            </>
          ) : showUndo ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onUndo(approval)}
            >
              <Undo2 className="size-4" />
              {t("manager.approval.undo")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TranscriptItem({
  item,
  isMarkdownAnimating,
  isDeciding,
  isUndoing,
  onDecision,
  onUndo,
}: {
  item: MemoryManagerTranscriptItem;
  isMarkdownAnimating: boolean;
  isDeciding: boolean;
  isUndoing: boolean;
  onDecision: (
    approval: PyMemoryManagerApproval,
    decision: "approve" | "reject",
    feedback?: string,
  ) => void;
  onUndo: (approval: PyMemoryManagerApproval) => void;
}) {
  if (item.kind === "approval") {
    return (
      <ApprovalCard
        approval={item.approval}
        isDeciding={isDeciding}
        isUndoing={isUndoing}
        onDecision={onDecision}
        onUndo={onUndo}
      />
    );
  }

  if (item.kind === "loader") {
    return (
      <Message from="assistant" messageLayout="chat-only">
        <MessageContent
          animateOnEnter
          className="w-full max-w-full"
          from="assistant"
          messageLayout="chat-only"
          variant="flat"
        >
          <MessageLoaderV2 animation="fade" className="h-3 justify-start" />
        </MessageContent>
      </Message>
    );
  }

  const { message, approvals } = item;
  return (
    <div className="min-w-0 space-y-3">
      <Message from={message.role} messageLayout="chat-only">
        <MessageContent
          animateOnEnter={message.animateOnEnter}
          className={cn(
            // Long unbroken tokens such as manager paths must wrap rather
            // than widen the Work pane; code blocks keep their own scroll.
            "min-w-0 [overflow-wrap:anywhere]",
            message.role === "assistant" && "w-full max-w-full",
          )}
          from={message.role}
          messageLayout="chat-only"
          variant={message.role === "assistant" ? "flat" : "contained"}
        >
          {message.role === "assistant" ? (
            <StreamdownResponse
              animated={MEMORY_MANAGER_MARKDOWN_ANIMATION}
              className="max-w-full min-w-0"
              isAnimating={isMarkdownAnimating}
              parseMarkdownIntoBlocksFn={parseMarkdownAsSingleBlock}
            >
              {message.content}
            </StreamdownResponse>
          ) : (
            <PlainTextResponse>{message.content}</PlainTextResponse>
          )}
        </MessageContent>
      </Message>
      {approvals.map((approval) => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          isDeciding={isDeciding}
          isUndoing={isUndoing}
          onDecision={onDecision}
          onUndo={onUndo}
        />
      ))}
    </div>
  );
}

/** Presents the manager runtime through the shared main-chat visual system. */
export function MemoryManagerChatPanel({
  snapshot,
  composer,
  optimisticSubmission,
  animatingAssistantMessageId,
  isSending,
  isLoading,
  isError,
  isClosed,
  isBusy,
  hasPendingApproval,
  episodeProcessingComposerLocked,
  isDeciding,
  isUndoing,
  onComposerChange,
  onSubmit,
  onDecision,
  onUndo,
  onRetry,
}: MemoryManagerChatPanelProps) {
  const { t } = useTranslation("memory");
  const transcriptItems = useMemo(
    () =>
      projectMemoryManagerTranscript({
        messages: snapshot?.messages ?? [],
        approvals: snapshot?.approvals ?? [],
        optimisticSubmission,
      }),
    [optimisticSubmission, snapshot?.approvals, snapshot?.messages],
  );
  const failed = snapshot?.run.status === "failed";
  // The run stores the service's English error; other locales show a
  // translated summary with that English as secondary detail.
  const runError = snapshot?.run.error
    ? uncodedErrorText(snapshot.run.error, t("manager.runFailed"))
    : null;
  const completed = snapshot?.run.status === "completed";
  const processingStatus =
    episodeProcessingPresentation(snapshot?.run) ??
    reflectionPresentation(snapshot?.run, {
      hasAppliedChange: (snapshot?.approvals ?? []).some(
        isAppliedMemoryManagerApproval,
      ),
    });
  const composerDisabled =
    isBusy || hasPendingApproval || episodeProcessingComposerLocked;

  return (
    <div className="bg-background flex min-h-0 min-w-0 flex-1 flex-col">
      <ChatTranscript className="min-w-0">
        <ChatTranscriptContent className="mx-auto flex min-h-full w-full max-w-[800px] min-w-0 flex-col px-4 py-4">
          {processingStatus && !isLoading && !isError ? (
            <div
              role="status"
              className={cn(
                "mb-4 rounded-lg border p-4 text-sm",
                processingStatus.state === "processed"
                  ? "border-success/30 bg-success/5 text-success"
                  : processingStatus.state === "failed"
                    ? "border-destructive/30 bg-destructive/5 text-destructive"
                    : "border-primary/25 bg-primary/5 text-foreground",
              )}
            >
              <p className="font-medium">{processingStatus.title}</p>
              <p className="mt-1 opacity-80">{processingStatus.description}</p>
            </div>
          ) : null}
          {isLoading ? (
            <ChatTranscriptEmptyState
              description={t("manager.loadingDescription")}
              icon={<Loader2 className="size-6 animate-spin" />}
              title={t("manager.loadingTitle")}
            />
          ) : isError ? (
            <ChatTranscriptEmptyState className="gap-4">
              <AlertTriangle className="text-destructive size-8" />
              <div>
                <p className="text-foreground text-sm font-medium">
                  {t("manager.loadFailed")}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {t("manager.loadFailedHint")}
                </p>
              </div>
              <Button type="button" onClick={onRetry}>
                <RefreshCw className="size-4" />
                {t("shared.retry")}
              </Button>
            </ChatTranscriptEmptyState>
          ) : transcriptItems.length === 0 && !failed && !completed ? (
            <ChatTranscriptEmptyState
              description={t("manager.emptyDescription")}
              title={t("manager.emptyTitle")}
            />
          ) : (
            <div className="w-full min-w-0">
              {failed ? (
                <div
                  role="alert"
                  className="border-destructive/30 bg-destructive/5 text-destructive mb-4 rounded-lg border p-4 text-sm"
                >
                  <p className="font-medium">{t("manager.stopped")}</p>
                  <p className="mt-1">
                    {runError?.message ?? t("manager.stoppedFallback")}
                  </p>
                  {runError?.detail ? (
                    <p className="mt-1 text-xs opacity-80">{runError.detail}</p>
                  ) : null}
                </div>
              ) : null}
              {completed ? (
                <div
                  role="status"
                  className="border-border/70 bg-muted/30 text-muted-foreground mb-4 rounded-lg border p-4 text-sm"
                >
                  {t("manager.completed")}
                </div>
              ) : null}
              {transcriptItems.map((item) => (
                <TranscriptItem
                  key={item.key}
                  item={item}
                  isMarkdownAnimating={
                    item.kind === "message" &&
                    item.message.id === animatingAssistantMessageId
                  }
                  isDeciding={isDeciding}
                  isUndoing={isUndoing}
                  onDecision={onDecision}
                  onUndo={onUndo}
                />
              ))}
            </div>
          )}
        </ChatTranscriptContent>
        <ChatTranscriptScrollButton />
      </ChatTranscript>

      {!isClosed && !isLoading && !isError ? (
        <div className="border-border/40 bg-background shrink-0 border-t">
          <div className="mx-auto w-full max-w-[800px] px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <ChatInput
              actions={<ChatInputSubmit />}
              className="border-border/40 bg-background/90 backdrop-blur-xs"
              disabled={composerDisabled}
              loading={isSending}
              onChange={(event) => onComposerChange(event.target.value)}
              onSubmit={onSubmit}
              rows={2}
              submitMode="text-only"
              value={composer}
              variant="default"
            >
              <ChatInputTextArea
                aria-label={t("manager.messageLabel")}
                className="bg-transparent placeholder:text-sm"
                disabled={composerDisabled}
                placeholder={t("manager.placeholder")}
              />
            </ChatInput>
          </div>
        </div>
      ) : null}
    </div>
  );
}
