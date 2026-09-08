"use client";

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
  memoryManagerApprovalStatusLabel,
} from "@/lib/memory-manager/approval-undo";
import {
  MEMORY_MANAGER_MARKDOWN_ANIMATION,
  projectMemoryManagerTranscript,
  type MemoryManagerOptimisticSubmission,
  type MemoryManagerTranscriptItem,
} from "@/lib/memory-manager/transcript-projection";
import { episodeProcessingPresentation } from "@/lib/memory-manager/workspace-state";
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
  const pending = approval.status === "pending";
  const showUndo = canShowMemoryManagerApprovalUndo(approval, isUndoing);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const feedbackValidation = useMemo(
    () => validateMemoryManagerRejectionFeedback(feedback),
    [feedback],
  );
  const feedbackErrorId = `approval-feedback-error-${approval.id}`;
  return (
    <div className="w-full min-w-0 space-y-3">
      <MemoryDiffViewer preview={approval.preview} className="min-w-0" />
      {approval.decision_feedback ? (
        <div className="border-border/70 bg-muted/30 rounded-lg border px-3 py-2 text-sm">
          <p className="text-foreground font-medium">Rejection feedback</p>
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
            Request a revised memory change
          </label>
          <Textarea
            id={`approval-feedback-${approval.id}`}
            aria-describedby={feedbackErrorId}
            aria-invalid={!feedbackValidation.valid}
            autoFocus
            className="min-h-24 resize-y"
            disabled={isDeciding}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Explain what should change, such as a different Markdown path or wording."
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
                  ? "This rejects the current diff and sends your feedback to the manager."
                  : feedbackValidation.error}
              </p>
              <p className="text-muted-foreground mt-1">
                {feedback.length.toLocaleString()} /{" "}
                {MEMORY_MANAGER_REJECTION_FEEDBACK_MAX_CHARS.toLocaleString()}
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
                Cancel
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
                Send feedback
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium",
            approval.status === "approved" &&
              "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
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
                Reject
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isDeciding}
                onClick={() => setFeedbackOpen((current) => !current)}
              >
                <MessageSquareText className="size-4" />
                Request changes
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
                Approve
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
              Undo
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
            "min-w-0",
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
  const completed = snapshot?.run.status === "completed";
  const processingStatus = episodeProcessingPresentation(snapshot?.run);
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
                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200"
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
              description="Resolving the current conversation."
              icon={<Loader2 className="size-6 animate-spin" />}
              title="Loading memory manager"
            />
          ) : isError ? (
            <ChatTranscriptEmptyState className="gap-4">
              <AlertTriangle className="text-destructive size-8" />
              <div>
                <p className="text-foreground text-sm font-medium">
                  Failed to load this memory-manager conversation.
                </p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Retry it before changing its lifecycle.
                </p>
              </div>
              <Button type="button" onClick={onRetry}>
                <RefreshCw className="size-4" />
                Retry
              </Button>
            </ChatTranscriptEmptyState>
          ) : transcriptItems.length === 0 && !failed && !completed ? (
            <ChatTranscriptEmptyState
              description="Ask it to create, update, or organize a memory file."
              title="Start a memory conversation"
            />
          ) : (
            <div className="w-full min-w-0">
              {failed ? (
                <div
                  role="alert"
                  className="border-destructive/30 bg-destructive/5 text-destructive mb-4 rounded-lg border p-4 text-sm"
                >
                  <p className="font-medium">Memory manager stopped.</p>
                  <p className="mt-1">
                    {snapshot?.run.error ??
                      "The conversation could not continue. Select New to retry."}
                  </p>
                </div>
              ) : null}
              {completed ? (
                <div
                  role="status"
                  className="border-border/70 bg-muted/30 text-muted-foreground mb-4 rounded-lg border p-4 text-sm"
                >
                  This conversation is complete. Select New to begin another.
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
                aria-label="Memory manager message"
                className="bg-transparent placeholder:text-sm"
                disabled={composerDisabled}
                placeholder="Ask the memory manager to create or update a memory file"
              />
            </ChatInput>
          </div>
        </div>
      ) : null}
    </div>
  );
}
