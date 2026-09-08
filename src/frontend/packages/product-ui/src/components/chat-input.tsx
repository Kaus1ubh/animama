import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowUpIcon, Loader2, Phone } from "lucide-react";
import { useElementSize } from "../hooks/useElementSize";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Textarea } from "./textarea";
import { ShineBorder } from "./shine-border";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import {
  resolveChatInputSubmitState,
  type ChatInputSubmitMode,
} from "./chat-input-submit-state";
const CHAT_INPUT_COMPACT_GAP_PX = 8;
const CHAT_INPUT_MEASUREMENT_TOLERANCE_PX = 2;

type ChatInputLayoutMode = "compact" | "stacked";
type ChatInputMicMode = "dictation" | "voice";
type ChatInputMicWaveformMode = "live" | "synthetic" | "none";
type ChatInputContextPropKeys =
  | "variant"
  | "layoutMode"
  | "compactTextAreaWidth"
  | "setCompactTextAreaMultiline";

type TextareaMeasurement = {
  contentHeight: number;
  minimumHeight: number;
};

type MeasureTextareaOptions = {
  value?: string;
  width: number;
  rows?: number;
};

function measureTextareaHeight(
  textarea: HTMLTextAreaElement,
  { value, width, rows = 1 }: MeasureTextareaOptions,
): TextareaMeasurement {
  if (width <= 0) {
    return {
      contentHeight: 0,
      minimumHeight: 0,
    };
  }

  const normalizedRows = Math.max(rows, 1);
  const minimumValue = Array.from({ length: normalizedRows }, () => "x").join(
    "\n",
  );

  textarea.style.width = `${width}px`;
  textarea.value = minimumValue;
  const minimumHeight = textarea.scrollHeight;

  textarea.value = value ?? "";
  const contentHeight = Math.max(minimumHeight, textarea.scrollHeight);

  return {
    contentHeight,
    minimumHeight,
  };
}

interface ChatInputContextValue {
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
  onSubmit?: () => void;
  onVoice?: () => void;
  voiceAvailable?: boolean;
  loading?: boolean;
  onStop?: () => void;
  activeMicMode?: ChatInputMicMode | null;
  isMicCaptureActive?: boolean;
  isDictationPreparing?: boolean;
  isUserSpeaking?: boolean;
  isVoiceMicMuted?: boolean;
  onDictationStart?: () => void;
  onMicSessionStop?: () => void;
  onVoiceMicToggle?: () => void;
  dictationStream?: MediaStream | null;
  disabled?: boolean;
  micWaveformMode?: ChatInputMicWaveformMode;
  showMicWaveform?: boolean;
  submitMode?: ChatInputSubmitMode;
  variant?: "default" | "unstyled";
  rows?: number;
  layoutMode?: ChatInputLayoutMode;
  compactTextAreaWidth?: number;
  setCompactTextAreaMultiline?: (multiline: boolean) => void;
}

export const ChatInputContext = createContext<ChatInputContextValue>({});

type ChatInputProps = Omit<ChatInputContextValue, ChatInputContextPropKeys> & {
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  leadingActions?: React.ReactNode;
  variant?: "default" | "unstyled";
  rows?: number;
};

function ChatInput({
  children,
  actions,
  className,
  leadingActions,
  variant = "default",
  value,
  onChange,
  onSubmit,
  onVoice,
  voiceAvailable = true,
  loading,
  onStop,
  activeMicMode,
  isMicCaptureActive,
  isDictationPreparing,
  isUserSpeaking,
  isVoiceMicMuted,
  onDictationStart,
  onMicSessionStop,
  onVoiceMicToggle,
  dictationStream,
  disabled,
  micWaveformMode,
  showMicWaveform = true,
  submitMode = "text-or-voice",
  rows = 1,
}: ChatInputProps) {
  const [composerElement, setComposerElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [actionsMeasureElement, setActionsMeasureElement] =
    useState<HTMLDivElement | null>(null);
  const [leadingActionsMeasureElement, setLeadingActionsMeasureElement] =
    useState<HTMLDivElement | null>(null);
  const [compactTextAreaMultiline, setCompactTextAreaMultiline] =
    useState(false);
  const composerSize = useElementSize(composerElement);
  const actionsMeasureSize = useElementSize(actionsMeasureElement);
  const leadingActionsMeasureSize = useElementSize(
    leadingActionsMeasureElement,
  );
  const handleCompactTextAreaMultilineChange = useCallback(
    (multiline: boolean) => {
      setCompactTextAreaMultiline((current) =>
        current === multiline ? current : multiline,
      );
    },
    [],
  );
  const compactTextAreaWidth = useMemo(() => {
    if (variant !== "default" || !composerElement) {
      return 0;
    }

    const computedStyle = window.getComputedStyle(composerElement);
    const paddingWidth =
      Number.parseFloat(computedStyle.paddingLeft) +
      Number.parseFloat(computedStyle.paddingRight);
    const borderWidth =
      Number.parseFloat(computedStyle.borderLeftWidth) +
      Number.parseFloat(computedStyle.borderRightWidth);
    const compactSlots = [
      leadingActionsMeasureSize.width,
      actionsMeasureSize.width,
    ].filter((width) => width > 0).length;
    const compactGap = compactSlots * CHAT_INPUT_COMPACT_GAP_PX;

    return Math.max(
      0,
      composerSize.width -
        borderWidth -
        paddingWidth -
        leadingActionsMeasureSize.width -
        actionsMeasureSize.width -
        compactGap,
    );
  }, [
    actionsMeasureSize.width,
    composerElement,
    composerSize.width,
    leadingActionsMeasureSize.width,
    variant,
  ]);
  const layoutMode: ChatInputLayoutMode =
    variant === "default" &&
    compactTextAreaWidth > 0 &&
    compactTextAreaMultiline
      ? "stacked"
      : "compact";
  const hasLeadingActions = Boolean(leadingActions);
  const hasActions = Boolean(actions);
  const contextValue: ChatInputContextValue = {
    value,
    onChange,
    onSubmit,
    onVoice,
    voiceAvailable,
    loading,
    onStop,
    activeMicMode,
    isMicCaptureActive,
    isDictationPreparing,
    isUserSpeaking,
    isVoiceMicMuted,
    onDictationStart,
    onMicSessionStop,
    onVoiceMicToggle,
    dictationStream,
    disabled,
    micWaveformMode,
    showMicWaveform,
    submitMode,
    variant,
    rows,
    layoutMode,
    compactTextAreaWidth,
    setCompactTextAreaMultiline: handleCompactTextAreaMultilineChange,
  };

  return (
    <ChatInputContext.Provider value={contextValue}>
      <div
        ref={setComposerElement}
        className={cn(
          variant === "default" &&
            "border-input bg-background focus-within:ring-ring relative grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2 overflow-hidden rounded-2xl border p-2 focus-within:ring-1 focus-within:outline-none",
          variant === "default" &&
            layoutMode === "stacked" &&
            "grid-rows-[auto_auto]",
          variant === "unstyled" && "flex w-full items-start gap-2",
          className,
        )}
      >
        {variant === "default" ? (
          <ShineBorder
            borderWidth={1}
            duration={18}
            shineColor={["var(--primary)", "var(--secondary)", "var(--accent)"]}
          />
        ) : null}
        {leadingActions ? (
          <div
            ref={setLeadingActionsMeasureElement}
            className={cn(
              "col-start-1 flex items-center gap-1 self-end",
              layoutMode === "stacked" ? "row-start-2" : "row-start-1 mb-1",
            )}
          >
            {leadingActions}
          </div>
        ) : null}
        <div
          className={cn(
            "min-w-0",
            layoutMode === "stacked" && "col-span-3 row-start-1 w-full",
            layoutMode === "compact" &&
              hasLeadingActions &&
              hasActions &&
              "col-start-2 row-start-1",
            layoutMode === "compact" &&
              !hasLeadingActions &&
              hasActions &&
              "col-start-1 col-end-3 row-start-1",
            layoutMode === "compact" &&
              hasLeadingActions &&
              !hasActions &&
              "col-start-2 col-end-4 row-start-1",
            layoutMode === "compact" &&
              !hasLeadingActions &&
              !hasActions &&
              "col-span-3 row-start-1",
          )}
        >
          {children}
        </div>
        {actions ? (
          <div
            ref={setActionsMeasureElement}
            className={cn(
              "col-start-3 flex items-center gap-1 self-end justify-self-end",
              layoutMode === "stacked" ? "row-start-2" : "row-start-1 mb-1",
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </ChatInputContext.Provider>
  );
}

ChatInput.displayName = "ChatInput";

interface ChatInputTextAreaProps extends React.ComponentProps<typeof Textarea> {
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
  onSubmit?: () => void;
  variant?: "default" | "unstyled";
  interimSuffix?: string;
}

function ChatInputTextArea({
  onSubmit: onSubmitProp,
  value: valueProp,
  onChange: onChangeProp,
  interimSuffix: interimSuffixProp,
  className,
  variant: variantProp,
  ...props
}: ChatInputTextAreaProps) {
  const context = useContext(ChatInputContext);
  const value = valueProp ?? context.value ?? "";
  const onChange = onChangeProp ?? context.onChange;
  const onSubmit = onSubmitProp ?? context.onSubmit;
  const rows = context.rows ?? 1;

  // Convert parent variant to textarea variant unless explicitly overridden
  const variant =
    variantProp ?? (context.variant === "default" ? "unstyled" : "default");
  const interimSuffix = interimSuffixProp ?? "";
  const normalizedValue = typeof value === "string" ? value : "";
  const hasInterimOverlay =
    interimSuffix.length > 0 && normalizedValue.endsWith(interimSuffix);
  const overlayPrefix = hasInterimOverlay
    ? normalizedValue.slice(0, normalizedValue.length - interimSuffix.length)
    : normalizedValue;
  const layoutMode = context.layoutMode ?? "compact";
  const compactTextAreaWidth = context.compactTextAreaWidth ?? 0;
  const setCompactTextAreaMultiline = context.setCompactTextAreaMultiline;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const measurementTextareaRef = useRef<HTMLTextAreaElement>(null);
  const lastCompactTextAreaWidthRef = useRef(0);
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!onSubmit) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      if (typeof value !== "string" || value.trim().length === 0) {
        return;
      }
      e.preventDefault();
      onSubmit();
    }
  };

  const textareaClassName = cn(
    "max-h-[400px] min-h-0 resize-none overflow-x-hidden text-base",
    hasInterimOverlay && "text-transparent caret-foreground",
    variant === "unstyled" &&
      "border-none shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
    className,
  );

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const measurementTextarea = measurementTextareaRef.current;
    if (!textarea || !measurementTextarea) {
      return;
    }

    const renderedWidth = textarea.getBoundingClientRect().width;
    if (layoutMode === "compact" && renderedWidth > 0) {
      lastCompactTextAreaWidthRef.current = renderedWidth;
    }

    const renderedMeasurement = measureTextareaHeight(measurementTextarea, {
      value: normalizedValue,
      width: renderedWidth,
      rows,
    });

    if (renderedMeasurement.contentHeight > 0) {
      textarea.style.height = `${renderedMeasurement.contentHeight + 2}px`;
    }

    if (
      !setCompactTextAreaMultiline ||
      context.variant !== "default" ||
      normalizedValue.length === 0
    ) {
      setCompactTextAreaMultiline?.(false);
      return;
    }

    if (layoutMode === "stacked" && compactTextAreaWidth <= 0) {
      setCompactTextAreaMultiline(false);
      return;
    }

    const measuredCompactWidth =
      lastCompactTextAreaWidthRef.current > 0
        ? Math.min(lastCompactTextAreaWidthRef.current, compactTextAreaWidth)
        : compactTextAreaWidth;

    // In compact mode, trust the actual rendered textarea width so the first
    // wrapped frame immediately promotes to stacked before paint. In stacked
    // mode, reuse the last real compact width so a too-optimistic computed
    // width cannot collapse back and create a compact/stacked loop.
    const compactMeasurement =
      layoutMode === "compact"
        ? renderedMeasurement
        : measureTextareaHeight(measurementTextarea, {
            value: normalizedValue,
            width: measuredCompactWidth,
            rows,
          });

    setCompactTextAreaMultiline(
      compactMeasurement.contentHeight >
        compactMeasurement.minimumHeight + CHAT_INPUT_MEASUREMENT_TOLERANCE_PX,
    );
  }, [
    compactTextAreaWidth,
    context.variant,
    layoutMode,
    normalizedValue,
    rows,
    setCompactTextAreaMultiline,
  ]);

  return (
    <div
      className={cn(
        "relative",
        layoutMode === "stacked" ? "w-full" : "min-w-0 flex-1",
      )}
    >
      {hasInterimOverlay ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 overflow-hidden px-3 py-2 text-base break-words whitespace-pre-wrap"
        >
          <span className="text-foreground">{overlayPrefix}</span>
          <span className="text-muted-foreground/60">{interimSuffix}</span>
        </div>
      ) : null}
      <Textarea
        ref={measurementTextareaRef}
        aria-hidden="true"
        readOnly
        rows={rows}
        tabIndex={-1}
        className={cn(
          textareaClassName,
          "pointer-events-none absolute inset-0 -z-10 h-0 overflow-hidden opacity-0",
        )}
      />
      <Textarea
        ref={textareaRef}
        {...props}
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        className={cn("relative z-0", textareaClassName)}
        rows={rows}
      />
    </div>
  );
}

ChatInputTextArea.displayName = "ChatInputTextArea";

interface ChatInputSubmitProps extends React.ComponentProps<typeof Button> {
  onSubmit?: () => void;
  onVoice?: () => void;
  loading?: boolean;
  onStop?: () => void;
  activeMicMode?: ChatInputMicMode | null;
  onMicSessionStop?: () => void;
}

function ChatInputSubmit({
  onSubmit: onSubmitProp,
  onVoice: onVoiceProp,
  loading: loadingProp,
  onStop: onStopProp,
  activeMicMode: activeMicModeProp,
  onMicSessionStop: onMicSessionStopProp,
  className,
  disabled: disabledProp,
  onClick: onClickProp,
  ...props
}: ChatInputSubmitProps) {
  const context = useContext(ChatInputContext);
  const loading = loadingProp ?? context.loading;
  const onStop = onStopProp ?? context.onStop;
  const onSubmit = onSubmitProp ?? context.onSubmit;
  const onVoice = onVoiceProp ?? context.onVoice;
  const activeMicMode = activeMicModeProp ?? context.activeMicMode ?? null;
  const onMicSessionStop =
    onMicSessionStopProp ?? context.onMicSessionStop ?? undefined;
  const disabled = disabledProp ?? context.disabled;
  const isVoiceModeActive = activeMicMode === "voice";
  const hasText =
    typeof context.value === "string" && context.value.trim().length > 0;
  const submitState = resolveChatInputSubmitState({
    submitMode: context.submitMode ?? "text-or-voice",
    hasText,
    loading: Boolean(loading),
    hasStopHandler: Boolean(onStop),
    isVoiceModeActive,
    disabled: Boolean(disabled),
    voiceAvailable: context.voiceAvailable,
  });

  const stopIcon = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="12" height="12" />
    </svg>
  );

  const button = (
    <Button
      {...props}
      aria-label={props["aria-label"] ?? submitState.label}
      className={cn(
        "h-fit shrink-0 rounded-full border p-1.5 dark:border-zinc-600",
        className,
      )}
      disabled={submitState.disabled}
      onClick={(event) => {
        if (onClickProp) {
          onClickProp(event);
          return;
        }
        event.preventDefault();
        if (submitState.disabled) return;

        if (submitState.action === "submit") {
          onSubmit?.();
        } else if (submitState.action === "start-voice") {
          onVoice?.();
        } else if (submitState.action === "stop-voice") {
          onMicSessionStop?.();
        } else if (submitState.action === "stop-request") {
          onStop?.();
        }
      }}
    >
      {submitState.icon === "send" ? (
        <ArrowUpIcon />
      ) : submitState.icon === "stop" ? (
        stopIcon
      ) : submitState.icon === "loading" ? (
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      ) : (
        <Phone className="h-5 w-5" />
      )}
    </Button>
  );

  if (!submitState.tooltip) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">{submitState.tooltip}</TooltipContent>
    </Tooltip>
  );
}

ChatInputSubmit.displayName = "ChatInputSubmit";

export { ChatInput, ChatInputTextArea, ChatInputSubmit };
