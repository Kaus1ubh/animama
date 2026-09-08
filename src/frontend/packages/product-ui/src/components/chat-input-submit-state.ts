export type ChatInputSubmitMode = "text-or-voice" | "text-only";

export type ChatInputSubmitAction =
  | "submit"
  | "start-voice"
  | "stop-voice"
  | "stop-request"
  | null;

export type ChatInputSubmitIcon = "send" | "voice" | "stop" | "loading";

export type ChatInputSubmitState = {
  action: ChatInputSubmitAction;
  disabled: boolean;
  icon: ChatInputSubmitIcon;
  label: string;
  tooltip: string | null;
};

/** Resolves generic composer submit presentation without depending on React. */
export function resolveChatInputSubmitState({
  submitMode,
  hasText,
  loading,
  hasStopHandler,
  isVoiceModeActive,
  disabled,
  voiceAvailable = true,
}: {
  submitMode: ChatInputSubmitMode;
  hasText: boolean;
  loading: boolean;
  hasStopHandler: boolean;
  isVoiceModeActive: boolean;
  disabled: boolean;
  voiceAvailable?: boolean;
}): ChatInputSubmitState {
  if (submitMode === "text-only") {
    if (loading) {
      return {
        action: null,
        disabled: true,
        icon: "loading",
        label: "Sending message",
        tooltip: null,
      };
    }

    return {
      action: hasText ? "submit" : null,
      disabled: disabled || !hasText,
      icon: "send",
      label: "Send message",
      tooltip: null,
    };
  }

  if (loading && hasStopHandler) {
    return {
      action: "stop-request",
      disabled,
      icon: "stop",
      label: "Stop",
      tooltip: "Stop",
    };
  }

  if (hasText) {
    return {
      action: "submit",
      disabled,
      icon: "send",
      label: "Send message",
      tooltip: null,
    };
  }

  if (isVoiceModeActive) {
    return {
      action: "stop-voice",
      disabled,
      icon: "stop",
      label: "Stop voice mode",
      tooltip: "Stop voice mode",
    };
  }

  return {
    action: "start-voice",
    disabled: disabled || !voiceAvailable,
    icon: "voice",
    label: "Voice mode",
    tooltip: voiceAvailable
      ? "Voice mode"
      : "Offline speech recognition is unavailable",
  };
}
