import type { TFunction } from "i18next";
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
};

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

  if (hasText) {
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
