import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";

import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { isRecord } from "@/lib/records";

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

/** What PiP shows once no main-window chat can act on its commands. */
const NO_VOICE: DesktopPipVoiceState = {
  activeMode: null,
  canStartVoice: false,
  isDictationPreparing: false,
  isMicCaptureActive: false,
  isUserSpeaking: false,
  isVoiceMicMuted: false,
};

/** A command from PiP still fits the session, which may have moved on. */
function commandFits(
  command: DesktopPipVoiceCommand,
  voice: DesktopPipVoiceState,
): boolean {
  switch (command) {
    case "start-voice-mode":
      return voice.activeMode === null && voice.canStartVoice;
    case "toggle-voice-mute":
      return voice.activeMode === "voice";
    case "stop-mic-session":
      return voice.activeMode !== null;
  }
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
  const pipOpenRef = useRef(false);
  const handlersRef = useRef(handlers);
  const voiceRef = useRef(voice);
  const sequenceRef = useRef(0);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const send = useCallback(
    (state: DesktopPipVoiceState) => {
      if (!enabled || !pipBridge || !animaId) return;
      sequenceRef.current += 1;
      void pipBridge
        .publishRuntimeMessage(
          voiceMessage("voice", animaId, sequenceRef.current, state),
        )
        .catch(() => {});
    },
    [animaId, enabled, pipBridge],
  );
  const publish = useCallback(() => send(voiceRef.current), [send]);

  useEffect(() => {
    if (!enabled || !pipBridge || !animaId) return;
    let changed = false;
    const follow = (state: DesktopPipState) => {
      pipOpenRef.current = state.isOpen && state.animaId === animaId;
      setPipOpen(pipOpenRef.current);
    };
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
      if (
        isDesktopPipVoiceCommand(command) &&
        commandFits(command, voiceRef.current)
      ) {
        handlersRef.current[VOICE_COMMANDS[command]]();
      }
    });
    return () => {
      unsubscribeState();
      unsubscribeRuntime();
      // Leaving (Avatar-only view, another Anima) ends this chat's session,
      // and nothing here would answer PiP's commands.
      if (pipOpenRef.current) send(NO_VOICE);
      pipOpenRef.current = false;
      setPipOpen(false);
    };
  }, [animaId, enabled, pipBridge, publish, send]);

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

  useEffect(() => {
    if (!pipBridge || !animaId) return;
    // States arrive in the order the main window sent them. A remounted owner
    // starts its sequence again, so the sequence cannot order them.
    return pipBridge.onRuntimeMessage((message) => {
      if (
        message.animaId !== animaId ||
        message.type !== "voice" ||
        !isDesktopPipVoiceState(message.payload)
      ) {
        return;
      }
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
