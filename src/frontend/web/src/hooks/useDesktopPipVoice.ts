"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";

import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";

/** The main window's microphone session, as the PiP toolbar shows it. */
export type DesktopPipVoiceState = {
  activeMode: "dictation" | "voice" | null;
  /** Voice mode can start: the chat is ready and speech is available. */
  canStartVoice: boolean;
  isDictationPreparing: boolean;
  isMicCaptureActive: boolean;
  isUserSpeaking: boolean;
  isVoiceMicMuted: boolean;
};

/** The only actions PiP may ask of the main window's microphone session. */
export type DesktopPipVoiceCommand =
  | "start-voice-mode"
  | "stop-mic-session"
  | "toggle-voice-mute";

export type DesktopPipVoiceHandlers = {
  startVoiceMode: () => void;
  stopMicSession: () => void;
  toggleVoiceMute: () => void;
};

const VOICE_COMMANDS: Record<
  DesktopPipVoiceCommand,
  keyof DesktopPipVoiceHandlers
> = {
  "start-voice-mode": "startVoiceMode",
  "stop-mic-session": "stopMicSession",
  "toggle-voice-mute": "toggleVoiceMute",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Exported for tests: PiP shows only a complete, well-typed state. */
export function isDesktopPipVoiceState(
  value: unknown,
): value is DesktopPipVoiceState {
  return (
    isRecord(value) &&
    (value.activeMode === "dictation" ||
      value.activeMode === "voice" ||
      value.activeMode === null) &&
    typeof value.canStartVoice === "boolean" &&
    typeof value.isDictationPreparing === "boolean" &&
    typeof value.isMicCaptureActive === "boolean" &&
    typeof value.isUserSpeaking === "boolean" &&
    typeof value.isVoiceMicMuted === "boolean"
  );
}

/** Exported for tests: the main window ignores anything else from PiP. */
export function isDesktopPipVoiceCommand(
  value: unknown,
): value is DesktopPipVoiceCommand {
  return typeof value === "string" && Object.hasOwn(VOICE_COMMANDS, value);
}

function voiceMessage(
  type: "voice" | "voice-command",
  animaId: string,
  sequence: number,
  payload: unknown,
): DesktopPipRuntimeMessage {
  return { type, sequence, sentAtMs: performance.now(), animaId, payload };
}

function usePipBridge() {
  const platform = useRuntimePlatform();
  const pipBridge =
    platform.kind === "desktop" && platform.capabilities.nativePiP
      ? (platform.desktopBridge.pip ?? null)
      : null;
  const isPipWindow =
    platform.kind === "desktop" && platform.desktopBridge.windowRole === "pip";
  return { isPipWindow, pipBridge };
}

/**
 * Mirror the main window's microphone session into an open PiP window for
 * `animaId`, and run the voice commands PiP sends back.
 */
export function useDesktopPipVoiceOwner({
  animaId,
  handlers,
  voice,
}: {
  animaId: string | null;
  handlers: DesktopPipVoiceHandlers;
  voice: DesktopPipVoiceState;
}): void {
  const { isPipWindow, pipBridge } = usePipBridge();
  const enabled = Boolean(pipBridge && animaId && !isPipWindow);
  const [pipOpen, setPipOpen] = useState(false);
  const handlersRef = useRef(handlers);
  const voiceRef = useRef(voice);
  const sequenceRef = useRef(0);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const publish = useCallback(() => {
    if (!enabled || !pipBridge || !animaId) return;
    sequenceRef.current += 1;
    void pipBridge
      .publishRuntimeMessage(
        voiceMessage("voice", animaId, sequenceRef.current, voiceRef.current),
      )
      .catch(() => {});
  }, [animaId, enabled, pipBridge]);

  useEffect(() => {
    if (!enabled || !pipBridge || !animaId) return;
    let changed = false;
    const follow = (state: DesktopPipState) =>
      setPipOpen(state.isOpen && state.animaId === animaId);
    const unsubscribeState = pipBridge.onStateChange((state) => {
      changed = true;
      follow(state);
    });
    void pipBridge
      .getState()
      // A change that arrived first is newer than the initial state.
      .then((state) => (changed ? undefined : follow(state)))
      .catch(() => {});
    const unsubscribeRuntime = pipBridge.onRuntimeMessage((message) => {
      if (message.animaId !== animaId) return;
      if (message.type === "ready") {
        publish();
        return;
      }
      if (message.type !== "voice-command") return;
      const command = isRecord(message.payload)
        ? message.payload.command
        : null;
      if (isDesktopPipVoiceCommand(command)) {
        handlersRef.current[VOICE_COMMANDS[command]]();
      }
    });
    return () => {
      unsubscribeState();
      unsubscribeRuntime();
      setPipOpen(false);
    };
  }, [animaId, enabled, pipBridge, publish]);

  const {
    activeMode,
    canStartVoice,
    isDictationPreparing,
    isMicCaptureActive,
    isUserSpeaking,
    isVoiceMicMuted,
  } = voice;
  useEffect(() => {
    voiceRef.current = {
      activeMode,
      canStartVoice,
      isDictationPreparing,
      isMicCaptureActive,
      isUserSpeaking,
      isVoiceMicMuted,
    };
    // Nothing crosses to main while PiP is closed.
    if (pipOpen) publish();
  }, [
    activeMode,
    canStartVoice,
    isDictationPreparing,
    isMicCaptureActive,
    isUserSpeaking,
    isVoiceMicMuted,
    pipOpen,
    publish,
  ]);
}

/**
 * In the PiP window: the main window's latest microphone session for this
 * Anima (null until the first state arrives) and a way to send it commands.
 */
export function useDesktopPipVoiceConsumer(): {
  voice: DesktopPipVoiceState | null;
  sendVoiceCommand: (command: DesktopPipVoiceCommand) => void;
} {
  const { pipBridge } = usePipBridge();
  const params = useParams({ strict: false });
  const animaId = typeof params?.animaId === "string" ? params.animaId : null;
  const [voice, setVoice] = useState<DesktopPipVoiceState | null>(null);
  const sequenceRef = useRef(0);

  useEffect(() => {
    if (!pipBridge || !animaId) return;
    return pipBridge.onRuntimeMessage((message) => {
      if (
        message.animaId !== animaId ||
        message.type !== "voice" ||
        !isDesktopPipVoiceState(message.payload) ||
        message.sequence < sequenceRef.current
      ) {
        return;
      }
      sequenceRef.current = message.sequence;
      setVoice(message.payload);
    });
  }, [animaId, pipBridge]);

  const sendVoiceCommand = useCallback(
    (command: DesktopPipVoiceCommand) => {
      if (!pipBridge || !animaId) return;
      // Like `camera-preset`, a command is outside the owner's sequence.
      void pipBridge
        .publishRuntimeMessage(
          voiceMessage("voice-command", animaId, 0, { command }),
        )
        .catch(() => {});
    },
    [animaId, pipBridge],
  );

  return { sendVoiceCommand, voice };
}
