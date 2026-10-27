"use client";

import { useCallback, useEffect, useRef } from "react";
import { getI18n } from "react-i18next";
import { toast } from "sonner";

import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import type { DesktopShortcutMap } from "@/lib/settings/desktop-shortcuts";

type UseDesktopVoiceShortcutsArgs = {
  shortcuts: DesktopShortcutMap;
  quickChatAvailable?: boolean;
  voiceModeAvailable: boolean;
  voiceModeActive: boolean;
  isVoiceMicMuted: boolean;
  ttsAudioActive: boolean;
  onQuickChat?: () => void;
  onToggleDictation: () => void;
  onToggleVoiceMode: () => void;
  onToggleVoiceMute: () => void;
  onMuteVoiceMic: (options?: {
    flushPendingSpeech?: boolean;
  }) => void | Promise<void>;
  onUnmuteVoiceMic: () => void | Promise<void>;
  onSkipTts: () => void;
};

export function useDesktopVoiceShortcuts({
  shortcuts,
  quickChatAvailable = false,
  voiceModeAvailable,
  voiceModeActive,
  isVoiceMicMuted,
  ttsAudioActive,
  onQuickChat,
  onToggleDictation,
  onToggleVoiceMode,
  onToggleVoiceMute,
  onMuteVoiceMic,
  onUnmuteVoiceMic,
  onSkipTts,
}: UseDesktopVoiceShortcutsArgs): void {
  const platform = useRuntimePlatform();
  const statusErrorRef = useRef<string | null>(null);
  const pressToTalkHeldRef = useRef(false);
  const pressToTalkChangedMicRef = useRef(false);
  const pressToTalkUnmutePromiseRef = useRef<Promise<void> | null>(null);
  const voiceStateRef = useRef({
    voiceModeActive,
    isVoiceMicMuted,
  });
  const callbacksRef = useRef({
    onToggleDictation,
    onToggleVoiceMode,
    onToggleVoiceMute,
    onQuickChat,
    onMuteVoiceMic,
    onUnmuteVoiceMic,
    onSkipTts,
  });

  useEffect(() => {
    callbacksRef.current = {
      onToggleDictation,
      onToggleVoiceMode,
      onToggleVoiceMute,
      onQuickChat,
      onMuteVoiceMic,
      onUnmuteVoiceMic,
      onSkipTts,
    };
  }, [
    onMuteVoiceMic,
    onQuickChat,
    onSkipTts,
    onToggleDictation,
    onToggleVoiceMute,
    onToggleVoiceMode,
    onUnmuteVoiceMic,
  ]);

  useEffect(() => {
    voiceStateRef.current = {
      voiceModeActive,
      isVoiceMicMuted,
    };
  }, [isVoiceMicMuted, voiceModeActive]);

  const reportStatusError = useCallback((message: string) => {
    if (statusErrorRef.current === message) return;
    statusErrorRef.current = message;
    const t = getI18n().getFixedT(null, "app");
    toast.error(t("shortcuts.unavailable"), {
      description: message,
    });
  }, []);

  const handleStatus = useCallback(
    (status: DesktopShortcutsStatus) => {
      if (status.error) {
        reportStatusError(status.error);
        return;
      }
      statusErrorRef.current = null;
    },
    [reportStatusError],
  );

  const handlePressToTalkUp = useCallback(() => {
    pressToTalkHeldRef.current = false;
    if (!pressToTalkChangedMicRef.current) return;
    pressToTalkChangedMicRef.current = false;

    const muteAfterUnmuteSettles = () => {
      if (!voiceStateRef.current.voiceModeActive) return;
      void callbacksRef.current.onMuteVoiceMic({ flushPendingSpeech: true });
    };
    const pendingUnmute = pressToTalkUnmutePromiseRef.current;
    if (pendingUnmute) {
      void pendingUnmute.finally(muteAfterUnmuteSettles);
      return;
    }
    muteAfterUnmuteSettles();
  }, []);

  const handlePressToTalkDown = useCallback(() => {
    if (pressToTalkHeldRef.current) return;
    pressToTalkHeldRef.current = true;

    if (
      !voiceStateRef.current.voiceModeActive ||
      !voiceStateRef.current.isVoiceMicMuted
    ) {
      pressToTalkChangedMicRef.current = false;
      return;
    }

    pressToTalkChangedMicRef.current = true;
    const unmutePromise = Promise.resolve(
      callbacksRef.current.onUnmuteVoiceMic(),
    )
      .catch((error: unknown) => {
        const t = getI18n().getFixedT(null, "app");
        reportStatusError(
          error instanceof Error ? error.message : t("shortcuts.unmuteFailed"),
        );
      })
      .finally(() => {
        if (pressToTalkUnmutePromiseRef.current === unmutePromise) {
          pressToTalkUnmutePromiseRef.current = null;
        }
      });
    pressToTalkUnmutePromiseRef.current = unmutePromise;
  }, [reportStatusError]);

  useEffect(() => {
    if (voiceModeActive || !pressToTalkHeldRef.current) return;
    handlePressToTalkUp();
  }, [handlePressToTalkUp, voiceModeActive]);

  useEffect(() => {
    if (!platform.isDesktop || !platform.desktopBridge.shortcuts) return;
    const bridge = platform.desktopBridge.shortcuts;
    void bridge
      .configure({ shortcuts })
      .then((status) => {
        handleStatus(status);
        if (status.requiresPermission) {
          void bridge.requestPermissions();
        }
      })
      .catch((error: unknown) => {
        const t = getI18n().getFixedT(null, "app");
        reportStatusError(
          error instanceof Error
            ? error.message
            : t("shortcuts.configureFailed"),
        );
      });
  }, [handleStatus, platform, reportStatusError, shortcuts]);

  useEffect(() => {
    if (!platform.isDesktop || !platform.desktopBridge.shortcuts) return;
    const bridge = platform.desktopBridge.shortcuts;
    void bridge
      .setContext({
        quickChatAvailable,
        voiceModeAvailable,
        voiceModeActive,
        ttsAudioActive,
      })
      .then(handleStatus)
      .catch((error: unknown) => {
        const t = getI18n().getFixedT(null, "app");
        reportStatusError(
          error instanceof Error ? error.message : t("shortcuts.updateFailed"),
        );
      });
    return () => {
      void bridge
        .setContext({
          quickChatAvailable: false,
          voiceModeAvailable: false,
          voiceModeActive: false,
          ttsAudioActive: false,
        })
        .catch(() => {
          // noop
        });
    };
  }, [
    handleStatus,
    platform,
    reportStatusError,
    ttsAudioActive,
    quickChatAvailable,
    voiceModeActive,
    voiceModeAvailable,
  ]);

  useEffect(() => {
    if (!platform.isDesktop || !platform.desktopBridge.shortcuts) return;
    return platform.desktopBridge.shortcuts.onStatusChange(handleStatus);
  }, [handleStatus, platform]);

  useEffect(() => {
    if (!platform.isDesktop || !platform.desktopBridge.shortcuts) return;
    return platform.desktopBridge.shortcuts.onEvent((event) => {
      const callbacks = callbacksRef.current;
      if (event.action === "quick_chat" && event.phase === "down") {
        callbacks.onQuickChat?.();
        return;
      }
      if (event.action === "toggle_dictation" && event.phase === "down") {
        callbacks.onToggleDictation();
        return;
      }
      if (event.action === "toggle_voice_mode" && event.phase === "down") {
        callbacks.onToggleVoiceMode();
        return;
      }
      if (event.action === "toggle_voice_mute" && event.phase === "down") {
        callbacks.onToggleVoiceMute();
        return;
      }
      if (event.action === "skip_tts" && event.phase === "down") {
        callbacks.onSkipTts();
        return;
      }
      if (event.action === "press_to_talk" && event.phase === "down") {
        handlePressToTalkDown();
        return;
      }
      if (event.action === "press_to_talk" && event.phase === "up") {
        handlePressToTalkUp();
      }
    });
  }, [handlePressToTalkDown, handlePressToTalkUp, platform]);
}
