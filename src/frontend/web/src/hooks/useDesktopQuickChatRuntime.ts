"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getI18n } from "react-i18next";
import { toast } from "sonner";

import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import type { PyChatResponse } from "@/lib/content/catalogTypes";
import type { ChatMessage } from "@/ui/main/chat/useChatSession";
import type { ChatCrisisSupport } from "@animama/product-ui/chat";
import type { AiNoticeKind } from "@/lib/safety/aiNotice";

const QUICK_CHAT_RENDER_READY_FALLBACK_MS = 150;
const QUICK_CHAT_BASE_HEIGHT_PX = 760;

type AnimamaDesktopQuickChatBridge = NonNullable<
  NonNullable<Window["animamaDesktop"]>["quickChat"]
>;

export type DesktopQuickChatMicMode = "dictation" | "voice";

export type DesktopQuickChatPromptSuggestion = {
  label: string;
  text: string;
};

export type DesktopQuickChatVoiceState = {
  activeMode: DesktopQuickChatMicMode | null;
  isMicCaptureActive: boolean;
  isDictationPreparing: boolean;
  isUserSpeaking: boolean;
  isVoiceMicMuted: boolean;
  /** A reply is being spoken, so Quick Chat offers to skip it. */
  ttsAudioActive: boolean;
};

export type DesktopQuickChatSnapshot = {
  activeChat: PyChatResponse | null;
  animaId: string;
  /** Names the Anima in mirrored memory cue details. */
  animaName?: string | null;
  chatId: string | null;
  input: string;
  inputPlaceholder: string;
  canChat: boolean;
  chatMarkdownEnabled?: boolean;
  isStreaming: boolean;
  isAwaitingStreamingAnimationFinalization: boolean;
  displayMessages: ChatMessage[];
  promptSuggestions: DesktopQuickChatPromptSuggestion[];
  showPromptSuggestions: boolean;
  voice: DesktopQuickChatVoiceState;
  /** Mirrored AI notice and crisis card from the main window's session (spec R2, R4). */
  safety?: DesktopQuickChatSafetyState | null;
};

export type DesktopQuickChatSafetyState = {
  notice: { kind: AiNoticeKind; animaName: string | null } | null;
  noticeVisible: boolean;
  crisis: ChatCrisisSupport | null;
};

export type DesktopQuickChatCommand =
  | { type: "set-input"; input: string }
  | { type: "submit" }
  | { type: "submit-text"; text: string }
  | { type: "stop" }
  | { type: "start-dictation" }
  | { type: "start-voice-mode" }
  | { type: "stop-mic-session" }
  | { type: "toggle-voice-mute" }
  | { type: "skip-tts" }
  | { type: "refresh-model-state" }
  | { type: "dismiss-crisis-card" }
  /** Opens a memory cue's `MEMORIES.md` entry in the main window's Memory workspace. */
  | { type: "open-memory-entry"; entryId: string };

export type DesktopQuickChatCommandHandlers = {
  setInput: (input: string) => void;
  submit: () => void;
  submitText: (text: string) => void;
  stop: () => void;
  startDictation: () => void;
  startVoiceMode: () => void;
  stopMicSession: () => void;
  toggleVoiceMute: () => void;
  skipTts: () => void;
  refreshModelState: () => void;
  dismissCrisisCard: () => void;
  openMemoryEntry: (entryId: string) => void;
};

type UseDesktopQuickChatOwnerArgs = {
  chatId: string | null;
  enabled: boolean;
  handlers: DesktopQuickChatCommandHandlers;
  animaId: string;
  snapshot: DesktopQuickChatSnapshot;
};

type DesktopQuickChatOwnerControls = {
  quickChatAvailable: boolean;
  toggleQuickChat: () => void;
};

type DesktopQuickChatConsumerControls = {
  close: () => void;
  focusInputSignal: number;
  sendCommand: (command: DesktopQuickChatCommand) => void;
  snapshot: DesktopQuickChatSnapshot | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createQuickChatRuntimeMessage(
  type: DesktopQuickChatRuntimeMessage["type"],
  animaId: string,
  sequence: number,
  payload: unknown = null,
): DesktopQuickChatRuntimeMessage {
  return {
    type,
    animaId,
    sequence,
    sentAtMs: Date.now(),
    payload,
  };
}

/**
 * Memory entry IDs are generated as `mem-<uuid>`. The ID crosses a process
 * boundary before it becomes a route search value, so accept only a bounded
 * token of letters, digits, `-` and `_`.
 */
function isMemoryEntryId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
  );
}

/** Exported for tests: unknown command types from the Quick Chat window are ignored. */
export function isQuickChatCommand(
  value: unknown,
): value is DesktopQuickChatCommand {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "set-input":
      return typeof value.input === "string";
    case "submit-text":
      return typeof value.text === "string";
    case "open-memory-entry":
      return isMemoryEntryId(value.entryId);
    case "submit":
    case "stop":
    case "start-dictation":
    case "start-voice-mode":
    case "stop-mic-session":
    case "toggle-voice-mute":
    case "skip-tts":
    case "refresh-model-state":
    case "dismiss-crisis-card":
      return true;
    default:
      return false;
  }
}

/** Exported for tests. */
export function isQuickChatSnapshot(
  value: unknown,
): value is DesktopQuickChatSnapshot {
  if (!isRecord(value)) return false;
  if (!(isRecord(value.activeChat) || value.activeChat === null)) return false;
  if (typeof value.animaId !== "string") return false;
  if (
    "animaName" in value &&
    !(typeof value.animaName === "string" || value.animaName === null)
  ) {
    return false;
  }
  if (!(typeof value.chatId === "string" || value.chatId === null)) {
    return false;
  }
  if (typeof value.input !== "string") return false;
  if (typeof value.inputPlaceholder !== "string") return false;
  if (typeof value.canChat !== "boolean") return false;
  if (
    "chatMarkdownEnabled" in value &&
    typeof value.chatMarkdownEnabled !== "boolean"
  ) {
    return false;
  }
  if (typeof value.isStreaming !== "boolean") return false;
  if (
    typeof value.isAwaitingStreamingAnimationFinalization !== "boolean" ||
    !Array.isArray(value.displayMessages) ||
    !Array.isArray(value.promptSuggestions) ||
    typeof value.showPromptSuggestions !== "boolean" ||
    !isRecord(value.voice)
  ) {
    return false;
  }
  if ("safety" in value && !(value.safety === null || isRecord(value.safety))) {
    return false;
  }
  return true;
}

function resolveQuickChatBridge(
  platform: ReturnType<typeof useRuntimePlatform>,
): AnimamaDesktopQuickChatBridge | null {
  return platform.kind === "desktop" && platform.capabilities.nativeQuickChat
    ? (platform.desktopBridge.quickChat ?? null)
    : null;
}

export function useDesktopQuickChatOwner({
  chatId,
  enabled,
  handlers,
  animaId,
  snapshot,
}: UseDesktopQuickChatOwnerArgs): DesktopQuickChatOwnerControls {
  const platform = useRuntimePlatform();
  const bridge = resolveQuickChatBridge(platform);
  const isMainWindow =
    platform.kind === "desktop" && platform.desktopBridge.windowRole === "main";
  const quickChatAvailable = Boolean(enabled && bridge && isMainWindow);
  const sequenceRef = useRef(0);
  const handlersRef = useRef(handlers);
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const publishSnapshot = useCallback(() => {
    if (!bridge || !quickChatAvailable) return;
    const message = createQuickChatRuntimeMessage(
      "snapshot",
      animaId,
      ++sequenceRef.current,
      snapshotRef.current,
    );
    void bridge.publishRuntimeMessage(message).catch(() => {});
  }, [bridge, animaId, quickChatAvailable]);

  useEffect(() => {
    if (!bridge || !quickChatAvailable) return;
    void bridge
      .prepare({
        animaId,
        chatId,
      })
      .then(() => {
        publishSnapshot();
      })
      .catch(() => {});
  }, [bridge, chatId, animaId, publishSnapshot, quickChatAvailable]);

  useEffect(() => {
    publishSnapshot();
  }, [publishSnapshot, snapshot]);

  useEffect(() => {
    if (!bridge || !quickChatAvailable) return;
    return bridge.onRuntimeMessage((message) => {
      if (message.animaId !== animaId) return;
      if (message.type === "request-snapshot") {
        publishSnapshot();
        return;
      }
      if (message.type !== "command" || !isQuickChatCommand(message.payload)) {
        return;
      }

      const currentHandlers = handlersRef.current;
      switch (message.payload.type) {
        case "set-input":
          currentHandlers.setInput(message.payload.input);
          return;
        case "submit":
          currentHandlers.submit();
          return;
        case "submit-text":
          currentHandlers.submitText(message.payload.text);
          return;
        case "stop":
          currentHandlers.stop();
          return;
        case "start-dictation":
          currentHandlers.startDictation();
          return;
        case "start-voice-mode":
          currentHandlers.startVoiceMode();
          return;
        case "stop-mic-session":
          currentHandlers.stopMicSession();
          return;
        case "toggle-voice-mute":
          currentHandlers.toggleVoiceMute();
          return;
        case "skip-tts":
          currentHandlers.skipTts();
          return;
        case "refresh-model-state":
          currentHandlers.refreshModelState();
          return;
        case "dismiss-crisis-card":
          currentHandlers.dismissCrisisCard();
          return;
        case "open-memory-entry":
          currentHandlers.openMemoryEntry(message.payload.entryId);
          return;
      }
    });
  }, [bridge, animaId, publishSnapshot, quickChatAvailable]);

  const toggleQuickChat = useCallback(() => {
    // Read at call time, so a locale switch does not recreate the callback.
    const t = getI18n().getFixedT(null, "app");
    if (!bridge || !quickChatAvailable) {
      toast.error(t("quickChat.unavailable"));
      return;
    }
    void bridge
      .toggle({
        animaId,
        chatId,
      })
      .then(() => {
        publishSnapshot();
      })
      .catch((error: unknown) => {
        toast.error(t("quickChat.toggleFailed"), {
          description:
            error instanceof Error
              ? error.message
              : t("quickChat.unknownError"),
        });
      });
  }, [bridge, chatId, animaId, publishSnapshot, quickChatAvailable]);

  return {
    quickChatAvailable,
    toggleQuickChat,
  };
}

export function useDesktopQuickChatConsumer(
  animaId: string,
): DesktopQuickChatConsumerControls {
  const platform = useRuntimePlatform();
  const bridge = resolveQuickChatBridge(platform);
  const isQuickChatWindow =
    platform.kind === "desktop" &&
    platform.desktopBridge.windowRole === "quick-chat";
  const sequenceRef = useRef(0);
  const [snapshot, setSnapshot] = useState<DesktopQuickChatSnapshot | null>(
    null,
  );
  const [focusInputSignal, setFocusInputSignal] = useState(0);
  const readyPublishedRef = useRef(false);

  const publish = useCallback(
    (type: DesktopQuickChatRuntimeMessage["type"], payload: unknown = null) => {
      if (!bridge || !isQuickChatWindow) return;
      const message = createQuickChatRuntimeMessage(
        type,
        animaId,
        ++sequenceRef.current,
        payload,
      );
      void bridge.publishRuntimeMessage(message).catch(() => {});
    },
    [bridge, isQuickChatWindow, animaId],
  );

  useEffect(() => {
    if (!bridge || !isQuickChatWindow) return;
    return bridge.onRuntimeMessage((message) => {
      if (message.animaId !== animaId) return;
      if (message.type === "snapshot" && isQuickChatSnapshot(message.payload)) {
        setSnapshot(message.payload);
        return;
      }
      if (message.type === "focus-input") {
        setFocusInputSignal((current) => current + 1);
      }
    });
  }, [bridge, isQuickChatWindow, animaId]);

  useEffect(() => {
    readyPublishedRef.current = false;
    setSnapshot(null);
    setFocusInputSignal(0);
  }, [bridge, isQuickChatWindow, animaId]);

  useEffect(() => {
    if (!bridge || !isQuickChatWindow) return;
    publish("request-snapshot");
  }, [bridge, isQuickChatWindow, publish]);

  useEffect(() => {
    if (
      !bridge ||
      !isQuickChatWindow ||
      !snapshot ||
      snapshot.animaId !== animaId ||
      readyPublishedRef.current
    ) {
      return;
    }

    let timeoutId: number | null = null;
    const publishReady = () => {
      if (readyPublishedRef.current) return;
      readyPublishedRef.current = true;
      publish("ready");
    };

    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(publishReady, 0);
    });
    const fallbackTimeoutId = window.setTimeout(() => {
      window.cancelAnimationFrame(frameId);
      publishReady();
    }, QUICK_CHAT_RENDER_READY_FALLBACK_MS);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(fallbackTimeoutId);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [bridge, isQuickChatWindow, animaId, publish, snapshot]);

  const sendCommand = useCallback(
    (command: DesktopQuickChatCommand) => {
      publish("command", command);
    },
    [publish],
  );

  const close = useCallback(() => {
    if (!bridge || !isQuickChatWindow) return;
    void bridge.close().catch(() => {});
  }, [bridge, isQuickChatWindow]);

  return {
    close,
    focusInputSignal,
    sendCommand,
    snapshot,
  };
}

/**
 * Whether this Quick Chat window is open, following the main process's
 * state. Null outside the Quick Chat window and until the first state arrives.
 */
export function useDesktopQuickChatWindowOpen(): boolean | null {
  const platform = useRuntimePlatform();
  const bridge = resolveQuickChatBridge(platform);
  const isQuickChatWindow =
    platform.kind === "desktop" &&
    platform.desktopBridge.windowRole === "quick-chat";
  const [isOpen, setIsOpen] = useState<boolean | null>(null);

  useEffect(() => {
    if (!bridge || !isQuickChatWindow) return;
    let disposed = false;
    let changed = false;
    const unsubscribe = bridge.onStateChange((state) => {
      changed = true;
      setIsOpen(state.isOpen);
    });
    void bridge
      .getState()
      .then((state) => {
        // A pushed change is newer than this initial read.
        if (!disposed && !changed) setIsOpen(state.isOpen);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [bridge, isQuickChatWindow]);

  return isQuickChatWindow ? isOpen : null;
}

/**
 * Marks the Quick Chat document with `data-animama-quick-chat-closed` while
 * its native window is closed, so global CSS pauses animations there.
 *
 * Prewarming keeps the hidden window painting with background throttling off,
 * so the page still reports itself visible. Without the pause, an infinite
 * animation such as the composer's shine border repaints the hidden window at
 * display rate.
 */
export function usePauseClosedQuickChatAnimations(): void {
  const isOpen = useDesktopQuickChatWindowOpen();

  useEffect(() => {
    if (isOpen === null) return;
    const root = document.documentElement;
    root.toggleAttribute("data-animama-quick-chat-closed", !isOpen);
    return () => {
      root.removeAttribute("data-animama-quick-chat-closed");
    };
  }, [isOpen]);
}

export function useDesktopQuickChatInteractiveRegions(active: boolean): void {
  const platform = useRuntimePlatform();
  const bridge = resolveQuickChatBridge(platform);
  const isQuickChatWindow =
    platform.kind === "desktop" &&
    platform.desktopBridge.windowRole === "quick-chat";
  // A closed window needs no regions or size; opening measures at once.
  const isOpen = useDesktopQuickChatWindowOpen();
  const measuring = active && isOpen !== false;

  useEffect(() => {
    if (!measuring || !bridge || !isQuickChatWindow) return;

    const publishRegions = () => {
      const regions = Array.from(
        document.querySelectorAll<HTMLElement>(
          [
            "[data-quick-chat-interactive]",
            "[data-slot='dialog-content']",
            "[data-slot='popover-content']",
          ].join(","),
        ),
      )
        .map((element) => element.getBoundingClientRect())
        .filter(
          (rect) =>
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.left < window.innerWidth &&
            rect.top < window.innerHeight,
        )
        .map((rect) => ({
          x: Math.max(0, rect.left),
          y: Math.max(0, rect.top),
          width:
            Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left),
          height:
            Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top),
        }));

      void bridge.setInteractiveRegions(regions).catch(() => {});

      const inputRegion = document.querySelector<HTMLElement>(
        "[data-quick-chat-input-region]",
      );
      const messageStack = document.querySelector<HTMLElement>(
        "[data-quick-chat-message-stack]",
      );
      const messageViewport = messageStack?.parentElement;
      if (!inputRegion || !messageStack || !messageViewport) return;

      const inputHeight = inputRegion.getBoundingClientRect().height;
      const bottomSpacerHeight = Math.max(
        0,
        (QUICK_CHAT_BASE_HEIGHT_PX - inputHeight) / 2,
      );
      document.documentElement.style.setProperty(
        "--anima-quick-chat-bottom-spacer",
        `${bottomSpacerHeight}px`,
      );

      const viewportStyle = window.getComputedStyle(messageViewport);
      const viewportPadding =
        Number.parseFloat(viewportStyle.paddingTop) +
        Number.parseFloat(viewportStyle.paddingBottom);
      const desiredMessageViewportHeight =
        messageStack.scrollHeight + viewportPadding;

      void bridge
        .setLayoutMetrics({
          desiredHeight: Math.max(
            QUICK_CHAT_BASE_HEIGHT_PX,
            inputHeight + bottomSpacerHeight + desiredMessageViewportHeight,
          ),
        })
        .catch(() => {});
    };

    publishRegions();
    const interval = window.setInterval(publishRegions, 100);
    window.addEventListener("resize", publishRegions);
    window.addEventListener("scroll", publishRegions, true);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", publishRegions);
      window.removeEventListener("scroll", publishRegions, true);
      document.documentElement.style.removeProperty(
        "--anima-quick-chat-bottom-spacer",
      );
      void bridge.setInteractiveRegions([]).catch(() => {});
    };
  }, [bridge, isQuickChatWindow, measuring]);
}
