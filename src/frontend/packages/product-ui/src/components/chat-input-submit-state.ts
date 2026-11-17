import type { TFunction } from "i18next";
import type { ChatAttachmentHold } from "../chat/session-bindings";
import { productEnglishT } from "../i18n/product-translation";

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
  /** The tooltip's keyboard shortcut, shown in a keycap after it. */
  tooltipShortcut?: string | null;
  /**
   * The typed message waits on its attachments: the control does not send,
   * and stays focusable so its tooltip can say why.
   */
  held?: boolean;
};

/** The control for a typed message its attachments hold. */
function heldSubmitState(
  hold: Exclude<ChatAttachmentHold, "none">,
  disabled: boolean,
  t: TFunction<"product">,
): ChatInputSubmitState {
  const label =
    hold === "waiting"
      ? t("composer.waitingForFiles")
      : t("composer.removeUnreadableFiles");
  return {
    action: null,
    disabled,
    held: true,
    icon: hold === "waiting" ? "loading" : "send",
    label,
    tooltip: label,
  };
}

/**
 * Resolves generic composer submit presentation without depending on React;
 * labels use `t` (English by default).
 */
export function resolveChatInputSubmitState(
  {
    submitMode,
    hasText,
    loading,
    hasStopHandler,
    isVoiceModeActive,
    disabled,
    voiceAvailable = true,
    voiceModeShortcut = null,
    attachmentHold = "none",
  }: {
    submitMode: ChatInputSubmitMode;
    hasText: boolean;
    loading: boolean;
    hasStopHandler: boolean;
    isVoiceModeActive: boolean;
    disabled: boolean;
    voiceAvailable?: boolean;
    /** Display text of the Voice Mode on/off shortcut, if the host has one. */
    voiceModeShortcut?: string | null;
    /**
     * Holds typed text while its attachments are not readable yet. Stopping a
     * reply or Voice Mode is unaffected.
     */
    attachmentHold?: ChatAttachmentHold;
  },
  t: TFunction<"product"> = productEnglishT(),
): ChatInputSubmitState {
  if (submitMode === "text-only") {
    if (loading) {
      return {
        action: null,
        disabled: true,
        icon: "loading",
        label: t("composer.sending"),
        tooltip: null,
      };
    }

    if (hasText && attachmentHold !== "none") {
      return heldSubmitState(attachmentHold, disabled, t);
    }

    return {
      action: hasText ? "submit" : null,
      disabled: disabled || !hasText,
      icon: "send",
      label: t("composer.send"),
      tooltip: null,
    };
  }

  if (loading && hasStopHandler) {
    return {
      action: "stop-request",
      disabled,
      icon: "stop",
      label: t("composer.stop"),
      tooltip: t("composer.stop"),
    };
  }

  const held = hasText && attachmentHold !== "none";
  // Text that cannot be sent yet leaves Voice Mode its stop control.
  if (held && !isVoiceModeActive) {
    return heldSubmitState(attachmentHold, disabled, t);
  }

  if (hasText && !held) {
    return {
      action: "submit",
      disabled,
      icon: "send",
      label: t("composer.send"),
      tooltip: null,
    };
  }

  if (isVoiceModeActive) {
    return {
      action: "stop-voice",
      disabled,
      icon: "stop",
      label: t("composer.stopVoice"),
      tooltip: t("composer.stopVoice"),
      tooltipShortcut: voiceModeShortcut,
    };
  }

  return {
    action: "start-voice",
    disabled: disabled || !voiceAvailable,
    icon: "voice",
    label: t("composer.voiceMode"),
    tooltip: voiceAvailable
      ? t("composer.voiceMode")
      : t("composer.speechUnavailable"),
    // An unavailable control explains why instead of offering the shortcut.
    tooltipShortcut: voiceAvailable ? voiceModeShortcut : null,
  };
}
