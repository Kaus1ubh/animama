import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAnima } from "../query/hooks/useAnima";
import { useChat } from "../query/hooks/useChat";
import { useChatMessages } from "../query/hooks/useChatMessages";
import { useModelProviders } from "../query/hooks/useModelProviders";
import { useCreateChat } from "../query/mutations/useCreateChat";
import { useChatSse } from "../query/mutations/useChatSse";
import { useUpdateAnimaChatProfile } from "../query/mutations/useUpdateAnimaChatProfile";
import type {
  PyChatMessage,
  PyChatResponse,
  PyAnimaResponse,
  PyModelProviderCatalogItem,
  PyAnimaDispatchOptions,
} from "@animama/runtime-contracts/api-types";
import { queryKeys } from "../query/keys";
import {
  chatModelSendGate,
  findRestorableChatModel,
} from "../lib/chat/model-provider-compatibility";
import { buildChatSseRequestBody } from "../lib/chat/chat-sse-request";
import { isRuntimeRemountRequired } from "../lib/runtime-errors";
import { runtimeRemountRecovery } from "../lib/chat/runtimeRemountRecovery";
import {
  chatRunMessageId,
  mapServerMessagesForDisplay,
  type ChatDisplayMessage,
} from "../lib/chat/display-message-mapping";
import {
  appendStructuredSpeechVisemeInputs,
  createStructuredResponseStreamState,
  getStructuredAssistantTexts,
  reduceStructuredResponseStream,
  selectStructuredSpeechVisemePayload,
  selectStructuredSpeechTtsPayload,
  type AccumulatedStructuredSpeechVisemeInputs,
  type StructuredSpeechTtsPayload,
} from "../lib/chat/structured-response-stream";
import {
  emotionStateFromValues,
  type EmotionStateMap,
  type EmotionValue,
} from "../lib/emotion";
import { getAnimaDisplayName } from "../lib/anima-profile";
import {
  useRuntimeOwnerId,
  useProductRuntime,
} from "../runtime/ProductRuntimeProvider";
import {
  useProductDiagnostics,
  useProductLogger,
} from "../runtime/diagnostics";
import {
  textOnlyChatEffects,
  textOnlySpeechPolicy,
  type ChatSessionEffects,
  type ChatSpeechPolicy,
  type ChatRuntimeFence,
  type InputMode,
  type VoiceSubmitReason,
} from "./session-bindings";
export type ChatMessage = ChatDisplayMessage;

export type UseProductChatSessionResult = {
  activeChat: PyChatResponse | null;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  animaName: string | null;
  inputPlaceholder: string;
  canChat: boolean;
  isStreaming: boolean;
  isAwaitingStreamingAnimationFinalization: boolean;
  displayMessages: ChatMessage[];
  handleSubmit: () => Promise<void>;
  handleSubmitText: (args: {
    text: string;
    inputMode?: InputMode;
    submitReason?: VoiceSubmitReason | "manual";
    turnId?: string | null;
    smartTurnJobId?: string | null;
    smartTurnScore?: number | null;
    smartTurnLatencyMs?: number | null;
    clearInput?: boolean;
  }) => Promise<void>;
  handleStop: () => void;
  handleSkipTts: () => void;
  isTtsAudioActive: boolean;
  handleStreamingAnimationComplete: () => void;
  pendingModelSwitch: PendingModelSwitch | null;
  requestModelSwitchToNewChat: (item: PyModelProviderCatalogItem) => void;
  cancelPendingModelSwitch: () => void;
  confirmPendingModelSwitch: () => Promise<void>;
  isConfirmingModelSwitch: boolean;
};

export type UseProductChatSessionArgs = {
  runtime: ChatRuntimeFence;
  effects?: ChatSessionEffects;
  speech?: ChatSpeechPolicy;
  dispatchOptions?: PyAnimaDispatchOptions | null;
  disableVfx?: boolean;
  animaId: string;
  routeChatId?: string | null;
  getAttachedFileIds?: () => string[];
  openDraftChatRoute: () => void | Promise<void>;
  replaceChatRoute: (chatId: string) => void | Promise<void>;
};

export type PendingModelSwitch = {
  item: PyModelProviderCatalogItem;
};

type PendingStreamFinalization = {
  chatId: string;
  messagesKey: ReturnType<typeof queryKeys.chats.messages>;
  nextMessages: PyChatMessage[];
  runId: string;
  requestNonTtsAvatarCompletion: boolean;
  refreshChatListsOnComplete: boolean;
};

/** Text chat depends on the issued runtime fence, not visual preparation. */
export function chatSessionCanChat(args: {
  animaId: string | null;
  loadedAnimaId: string | null;
  runtimeRevision: string | null;
  runtimeCanChat: boolean;
}): boolean {
  return Boolean(
    args.animaId &&
    args.loadedAnimaId === args.animaId &&
    args.runtimeRevision &&
    args.runtimeCanChat,
  );
}

// -----------------------------------------------------------------------------
// Small chat-specific utilities.
// -----------------------------------------------------------------------------
function genRunId(): string {
  return `ui-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function isAnimaResponse(value: unknown): value is PyAnimaResponse {
  return value !== null && typeof value === "object" && "id" in value;
}

function patchAnimaEmotionSnapshot(
  current: unknown,
  animaId: string,
  emotionalState: EmotionStateMap,
): unknown {
  if (Array.isArray(current)) {
    return current.map((item) => {
      if (!isAnimaResponse(item) || item.id !== animaId) {
        return item;
      }
      return {
        ...item,
        emotional_state: emotionalState,
      };
    });
  }

  if (!isAnimaResponse(current) || current.id !== animaId) {
    return current;
  }

  return {
    ...current,
    emotional_state: emotionalState,
  };
}

/**
 * Orchestrates the chat runtime used by ChatInterface:
 * - route/anima resolution
 * - chat create/update
 * - chat SSE lifecycle
 * - optimistic/streaming message rendering
 * - avatar and TTS synchronization
 */
export function useProductChatSession({
  runtime: mountedRuntimeContent,
  effects = textOnlyChatEffects,
  speech = textOnlySpeechPolicy,
  dispatchOptions: chatRequestOptions,
  disableVfx = false,
  animaId,
  getAttachedFileIds,
  openDraftChatRoute,
  routeChatId = null,
  replaceChatRoute,
}: UseProductChatSessionArgs): UseProductChatSessionResult {
  // ---------------------------------------------------------------------------
  // Route + shared runtime dependencies.
  // ---------------------------------------------------------------------------
  const logger = useProductLogger("ChatInterface");
  const { recordUiInteraction, recordUiInteractionDuration } =
    useProductDiagnostics();
  const { capabilities } = useProductRuntime();
  const queryClient = useQueryClient();
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";

  useEffect(() => {
    logger.info("Route", "Params updated", {
      animaId,
      chatId: routeChatId,
    });
  }, [animaId, routeChatId, logger]);

  // ---------------------------------------------------------------------------
  // Local UI + stream state.
  // ---------------------------------------------------------------------------
  const [input, setInput] = useState("");
  const [draftChatId, setDraftChatId] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [streamingRunId, setStreamingRunId] = useState<string | null>(null);
  const [pendingModelSwitch, setPendingModelSwitch] =
    useState<PendingModelSwitch | null>(null);
  const [streamingSegments, setStreamingSegments] = useState<string[]>([]);
  const [streamingDisplayText, setStreamingDisplayText] = useState("");
  const [
    isAwaitingStreamingAnimationFinalization,
    setIsAwaitingStreamingAnimationFinalization,
  ] = useState(false);
  const streamingSegmentsRef = useRef<string[]>([]);
  const streamingDisplayTextRef = useRef("");
  // Structured speech/display parts carry their own accumulation semantics.
  // Keep that state separate from ordinary token streaming so fallback text
  // streams can continue using streamingSegments as a simple append-only list.
  const structuredResponseStateRef = useRef(
    createStructuredResponseStreamState(),
  );
  const pendingStreamFinalizationRef = useRef<PendingStreamFinalization | null>(
    null,
  );
  const restoredModelChatIdRef = useRef<string | null>(null);
  const skippedTtsRunIdsRef = useRef<Set<string>>(new Set());
  const activeChatId = routeChatId ?? draftChatId;
  const previousChatIdRef = useRef<string | null>(null);
  const suppressFetchChatRef = useRef<string | null>(null);
  const streamingText = useMemo(
    () => streamingSegments.join(""),
    [streamingSegments],
  );

  // ---------------------------------------------------------------------------
  // Server data dependencies.
  // ---------------------------------------------------------------------------
  const { data: anima } = useAnima(animaId);
  const {
    data: activeChat = null,
    isError: isActiveChatError,
    isLoading: isActiveChatLoading,
  } = useChat(activeChatId, { enabled: Boolean(activeChatId) });
  const { data: modelProviders = [], isLoading: isModelProvidersLoading } =
    useModelProviders();
  const updateAnimaChatProfile = useUpdateAnimaChatProfile();
  const activeModelProviderId =
    anima?.chat_profile?.default_model_provider_id ?? null;
  const activeModelProvider = useMemo(
    () =>
      activeModelProviderId
        ? (modelProviders.find((item) => item.id === activeModelProviderId) ??
          null)
        : null,
    [activeModelProviderId, modelProviders],
  );

  useEffect(() => {
    logger.info("UseAnima", "Anima Data", {
      anima,
      id: animaId,
    });
  }, [anima, animaId, logger]);

  const animaName = anima ? getAnimaDisplayName(anima) : null;
  const canChat = chatSessionCanChat({
    animaId,
    loadedAnimaId: anima?.id ?? null,
    runtimeRevision: mountedRuntimeContent.runtimeRevision,
    runtimeCanChat: mountedRuntimeContent.canChat && capabilities.chat,
  });
  const inputPlaceholder = !animaId
    ? "Loading anima..."
    : !canChat
      ? "Loading anima runtime..."
      : "What's on your mind?";

  const emptyServerMessages = useMemo(() => [] as PyChatMessage[], []);
  const shouldFetchMessages =
    Boolean(routeChatId) && routeChatId !== suppressFetchChatRef.current;
  const { data: serverMessagesData } = useChatMessages(activeChatId, {
    enabled: shouldFetchMessages,
  });
  const serverMessages = serverMessagesData ?? emptyServerMessages;
  const createChat = useCreateChat();
  const { startChat, stop, isStreaming } = useChatSse();

  const {
    resetAvatarRuntime,
    setAnimaEmotionSnapshot,
    startAvatarRun,
    markNonTtsResponseStarted,
    requestNonTtsResponseCompletion,
    markAvatarSpeechEnded,
    completeAvatarTurn,
    finishAvatarRun,
    abortAvatarRun,
    clearAvatarRuntimeVfx,
    applyAvatarEmotionUpdate,
    requestAvatarGesture,
    queueAvatarVisemeInputsForRun,
    clearAvatarVisemeBridgeRun,
    clearAvatarVisemeBridgeAll,
    startTtsRun,
    appendTtsToken,
    completeTtsRun,
    acceptElevenLabsSession,
    markElevenLabsSessionFailed,
    acceptElevenLabsFinalizedAudio,
    completeElevenLabsFinalizedAudio,
    markElevenLabsFinalizedAudioFailed,
    cancelTts,
    isTtsAudioActive,
  } = effects;

  // Shared helper to keep streaming UI state cleanup consistent across stop,
  // route changes, completion, and error paths.
  const clearStreamingState = useCallback(() => {
    setStreamingRunId(null);
    setStreamingSegments([]);
    setStreamingDisplayText("");
    setIsAwaitingStreamingAnimationFinalization(false);
    streamingSegmentsRef.current = [];
    streamingDisplayTextRef.current = "";
    structuredResponseStateRef.current = createStructuredResponseStreamState();
    pendingStreamFinalizationRef.current = null;
  }, []);
  const teardownActionsRef = useRef({
    stop,
    cancelTts,
    abortAvatarRun,
    clearAvatarVisemeBridgeAll,
  });

  useEffect(() => {
    teardownActionsRef.current = {
      stop,
      cancelTts,
      abortAvatarRun,
      clearAvatarVisemeBridgeAll,
    };
  }, [abortAvatarRun, cancelTts, clearAvatarVisemeBridgeAll, stop]);

  const selectProfileModel = useCallback(
    async (item: PyModelProviderCatalogItem) => {
      if (activeModelProviderId === item.id) return;
      await updateAnimaChatProfile.mutateAsync({
        animaId,
        body: {
          default_model_provider_id: item.id,
        },
      });
    },
    [activeModelProviderId, animaId, updateAnimaChatProfile],
  );

  const restoreActiveChatModel = useCallback(async () => {
    const restorable = findRestorableChatModel(activeChat, modelProviders);
    if (!restorable) return;
    try {
      await selectProfileModel(restorable);
    } catch (error) {
      logger.error("Model", "Failed to restore chat model", error);
      toast.error("Failed to restore this chat's model.");
    }
  }, [activeChat, logger, modelProviders, selectProfileModel]);

  const requestModelSwitchToNewChat = useCallback(
    (item: PyModelProviderCatalogItem) => {
      setPendingModelSwitch({ item });
    },
    [],
  );

  const cancelPendingModelSwitch = useCallback(() => {
    setPendingModelSwitch(null);
    void restoreActiveChatModel();
  }, [restoreActiveChatModel]);

  const confirmPendingModelSwitch = useCallback(async () => {
    const pending = pendingModelSwitch;
    if (!pending) return;
    try {
      await selectProfileModel(pending.item);
      setPendingModelSwitch(null);
      setDraftChatId(null);
      suppressFetchChatRef.current = null;
      await openDraftChatRoute();
    } catch (error) {
      logger.error("Model", "Failed to start new chat with selected model", {
        error,
        modelProviderId: pending.item.id,
      });
      toast.error("Failed to start a new chat with that model.");
    }
  }, [logger, openDraftChatRoute, pendingModelSwitch, selectProfileModel]);

  const patchAnimaEmotionCaches = useCallback(
    (emotionValues: EmotionValue[] | null | undefined) => {
      if (
        !animaId ||
        !Array.isArray(emotionValues) ||
        emotionValues.length === 0
      ) {
        return;
      }

      const emotionalState = emotionStateFromValues(emotionValues);
      queryClient.setQueriesData(
        { queryKey: queryKeys.animas.all(userKey) },
        (current) =>
          patchAnimaEmotionSnapshot(current, animaId, emotionalState),
      );
    },
    [animaId, queryClient, userKey],
  );

  const patchChatTitleCaches = useCallback(
    (chatId: string, title: string, chatForInsert?: PyChatResponse | null) => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) return;
      const patchRows = (rows: PyChatResponse[] | undefined) => {
        if (!Array.isArray(rows)) return rows;
        if (rows.some((chat) => chat.id === chatId)) {
          return rows.map((chat) =>
            chat.id === chatId ? { ...chat, title: trimmedTitle } : chat,
          );
        }
        if (!chatForInsert || chatForInsert.id !== chatId) return rows;
        return [{ ...chatForInsert, title: trimmedTitle }, ...rows];
      };
      queryClient.setQueryData<PyChatResponse[]>(
        queryKeys.chats.list(userKey, {
          includeLastMessageAt: true,
        }),
        patchRows,
      );
      queryClient.setQueryData<PyChatResponse[]>(
        queryKeys.chats.list(userKey, {
          includeLastMessageAt: false,
        }),
        patchRows,
      );
    },
    [queryClient, userKey],
  );

  const finalizeCompletedStream = useCallback(
    (pending: PendingStreamFinalization) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.chats.detail(userKey, pending.chatId),
      });
      queryClient.setQueryData<PyChatMessage[]>(pending.messagesKey, (prev) => {
        const rows = Array.isArray(prev) ? prev : [];
        if (rows.some((msg) => msg.run_id === pending.runId)) return rows;
        return rows.concat(pending.nextMessages);
      });
      logger.info("Chat", "Refreshing messages cache with next messages", {
        nextMessages: pending.nextMessages,
        messagesKey: pending.messagesKey,
      });
      clearStreamingState();
      setLocalMessages((prev) =>
        prev.filter(
          (msg) => msg.id !== chatRunMessageId(pending.runId, "user"),
        ),
      );
      if (pending.refreshChatListsOnComplete) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.chats.list(userKey, {
            includeLastMessageAt: true,
          }),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.chats.list(userKey, {
            includeLastMessageAt: false,
          }),
        });
      }
    },
    [clearStreamingState, logger, queryClient, userKey],
  );

  const handleStreamingAnimationComplete = useCallback(() => {
    const pending = pendingStreamFinalizationRef.current;
    if (!pending) return;
    pendingStreamFinalizationRef.current = null;
    if (pending.requestNonTtsAvatarCompletion) {
      requestNonTtsResponseCompletion(pending.runId);
    }
    finalizeCompletedStream(pending);
  }, [finalizeCompletedStream, requestNonTtsResponseCompletion]);

  // ---------------------------------------------------------------------------
  // Effects: anima and route synchronization.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    resetAvatarRuntime(animaId);
  }, [animaId, resetAvatarRuntime]);

  useEffect(() => {
    clearAvatarVisemeBridgeAll({ clearAvatarLipSync: true });
  }, [clearAvatarVisemeBridgeAll, animaId]);

  useEffect(() => {
    if (!animaId || anima?.id !== animaId) return;
    setAnimaEmotionSnapshot(anima?.emotional_state ?? null);
  }, [anima?.emotional_state, anima?.id, animaId, setAnimaEmotionSnapshot]);

  useEffect(() => {
    if (disableVfx !== true) {
      return;
    }
    clearAvatarRuntimeVfx();
  }, [clearAvatarRuntimeVfx, disableVfx]);

  useEffect(() => {
    if (routeChatId && draftChatId === routeChatId) {
      setDraftChatId(null);
    }
  }, [routeChatId, draftChatId]);

  useEffect(() => {
    const chatId = routeChatId ?? null;
    if (!chatId) {
      restoredModelChatIdRef.current = null;
      return;
    }
    if (restoredModelChatIdRef.current === chatId) return;
    if (isActiveChatLoading || isModelProvidersLoading) return;
    if (!activeChat || activeChat.id !== chatId) return;
    restoredModelChatIdRef.current = chatId;

    const restorable = findRestorableChatModel(activeChat, modelProviders);
    if (!restorable || restorable.id === activeModelProviderId) return;
    void selectProfileModel(restorable).catch((error: unknown) => {
      logger.error("Model", "Failed to restore historical chat model", {
        error,
        chatId,
        modelProviderId: restorable.id,
      });
      toast.error("Failed to restore this chat's model.");
    });
  }, [
    activeChat,
    activeModelProviderId,
    isActiveChatLoading,
    isModelProvidersLoading,
    logger,
    modelProviders,
    routeChatId,
    selectProfileModel,
  ]);

  useEffect(() => {
    const previousId = previousChatIdRef.current;
    const nextId = activeChatId ?? null;
    if ((previousId && previousId !== nextId) || (!nextId && previousId)) {
      cancelTts();
      abortAvatarRun(streamingRunId);
      clearAvatarVisemeBridgeRun(streamingRunId, { clearAvatarLipSync: true });
      skippedTtsRunIdsRef.current.clear();
      setLocalMessages([]);
      clearStreamingState();
    }
    previousChatIdRef.current = nextId;
  }, [
    abortAvatarRun,
    cancelTts,
    clearAvatarVisemeBridgeRun,
    clearStreamingState,
    activeChatId,
    streamingRunId,
  ]);

  useEffect(() => {
    return () => {
      const actions = teardownActionsRef.current;
      actions.stop();
      actions.cancelTts();
      actions.abortAvatarRun();
      actions.clearAvatarVisemeBridgeAll({ clearAvatarLipSync: true });
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Derived message list rendered by ChatInterface.
  // ---------------------------------------------------------------------------
  const displayMessages = useMemo(() => {
    const base = mapServerMessagesForDisplay(serverMessages);
    const combined = base.concat(localMessages);
    if (streamingRunId) {
      combined.push({
        id: chatRunMessageId(streamingRunId, "assistant"),
        role: "assistant",
        text: streamingText,
        isPending: !streamingText,
        animateOnEnter: true,
        animateTextEffect: Boolean(streamingText),
        streamingSegments,
      });
      const displayText = streamingDisplayText.trim();
      if (displayText && displayText !== streamingText.trim()) {
        combined.push({
          id: chatRunMessageId(streamingRunId, "assistant", 1),
          role: "assistant",
          text: displayText,
          animateOnEnter: true,
          animateTextEffect: true,
        });
      }
    }
    return combined;
  }, [
    serverMessages,
    localMessages,
    streamingRunId,
    streamingDisplayText,
    streamingSegments,
    streamingText,
  ]);

  useEffect(() => {
    logger.debug("Chat Messages", "Preparing display messages", {
      serverMessages,
      localMessages,
      streamingRunId,
    });
  }, [serverMessages, localMessages, streamingRunId, logger]);

  // Stop button handler: cancel transport + audio/avatar side-effects and clear
  // pending streaming UI payload.
  const handleStop = useCallback(() => {
    const activeRunId = streamingRunId;
    stop();
    cancelTts();
    skippedTtsRunIdsRef.current.clear();
    abortAvatarRun(activeRunId);
    clearAvatarVisemeBridgeRun(activeRunId, { clearAvatarLipSync: true });
    clearStreamingState();
  }, [
    abortAvatarRun,
    cancelTts,
    clearAvatarVisemeBridgeRun,
    clearStreamingState,
    stop,
    streamingRunId,
  ]);

  const handleSkipTts = useCallback(() => {
    if (!isTtsAudioActive) return;
    const activeRunId =
      streamingRunId ?? pendingStreamFinalizationRef.current?.runId ?? null;
    cancelTts();
    if (activeRunId) {
      skippedTtsRunIdsRef.current.add(activeRunId);
    }
    if (activeRunId) {
      markAvatarSpeechEnded(activeRunId);
      finishAvatarRun(activeRunId);
      clearAvatarVisemeBridgeRun(activeRunId, { clearAvatarLipSync: true });
      return;
    }
    clearAvatarVisemeBridgeAll({ clearAvatarLipSync: true });
  }, [
    cancelTts,
    clearAvatarVisemeBridgeAll,
    clearAvatarVisemeBridgeRun,
    finishAvatarRun,
    isTtsAudioActive,
    markAvatarSpeechEnded,
    streamingRunId,
  ]);

  const submitMessage = useCallback(
    async (args: {
      text: string;
      clearInput?: boolean;
      inputMode?: InputMode;
      submitReason?: VoiceSubmitReason | "manual";
      turnId?: string | null;
      smartTurnJobId?: string | null;
      smartTurnScore?: number | null;
      smartTurnLatencyMs?: number | null;
    }) => {
      const {
        text,
        clearInput = true,
        inputMode = "typed",
        submitReason = "manual",
        turnId = null,
        smartTurnJobId = null,
        smartTurnScore = null,
        smartTurnLatencyMs = null,
      } = args;
      logger.info("Submit", "Submitting message", {
        inputLength: text.length,
        inputMode,
        submitReason,
        turnId,
        smartTurnJobId,
        smartTurnScore,
        smartTurnLatencyMs,
      });
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;
      const startTime = performance.now();
      let interactionStatus: "ok" | "error" | "invalid" = "ok";

      recordUiInteraction({
        action: "chat.submit",
        input_mode: inputMode,
        submit_reason: submitReason,
      });

      try {
        // 1) Validate chat preconditions tied to the active route/anima.
        if (!animaId) {
          interactionStatus = "invalid";
          logger.warn("Submit", "Missing anima id", { animaId });
          toast.error("Missing anima.");
          return;
        }
        if (!anima || anima.id !== animaId) {
          interactionStatus = "invalid";
          logger.warn("Submit", "Anima not loaded", {
            animaId,
            loadedAnimaId: anima?.id ?? null,
          });
          toast.error("Anima is still loading.");
          return;
        }
        if (
          !capabilities.chat ||
          !mountedRuntimeContent.canChat ||
          !mountedRuntimeContent.runtimeRevision
        ) {
          interactionStatus = "invalid";
          toast.error("Anima runtime is still loading.");
          return;
        }
        if (routeChatId && isActiveChatLoading) {
          interactionStatus = "invalid";
          toast.error("Chat is still loading.");
          return;
        }
        if (routeChatId && (isActiveChatError || !activeChat)) {
          interactionStatus = "invalid";
          toast.error("Chat could not be loaded.");
          return;
        }
        if (isModelProvidersLoading) {
          interactionStatus = "invalid";
          toast.error("Models are still loading.");
          return;
        }

        const modelGate = chatModelSendGate(activeChat, activeModelProvider);
        if (!modelGate.ok) {
          interactionStatus = "invalid";
          if (
            modelGate.reason === "api_standard_mismatch" &&
            activeModelProvider
          ) {
            requestModelSwitchToNewChat(activeModelProvider);
          } else if (modelGate.reason === "unsupported_model") {
            toast.error("This model is not available for direct chat yet.");
          } else {
            toast.error("Select a model before chatting.");
          }
          return;
        }

        // 2) Clear input eagerly once the submission is accepted locally.
        if (clearInput) {
          setInput("");
        }

        let workingChatId = activeChatId;
        let isNewChat = false;
        let createdChatForTitle: PyChatResponse | null = null;

        // 3) Ensure chat id exists before starting chat run events.
        if (!workingChatId) {
          const created = await createChat.mutateAsync({
            body: {
              anima_id: animaId,
              title: null,
            },
          });
          const createdChatId = created.id;
          workingChatId = createdChatId;
          createdChatForTitle = created;
          setDraftChatId(createdChatId);
          suppressFetchChatRef.current = createdChatId;
          isNewChat = true;
          logger.info("Chat", "Created chat", {
            animaId,
            chatId: createdChatId,
          });
        }

        if (!workingChatId) {
          throw new Error("Chat not created.");
        }

        const resolvedChatId = workingChatId;
        const ttsEnabled = speech.enabled;
        const useMainStructuredResponse = ttsEnabled;
        const ttsProvider = speech.provider;
        const elevenLabsModelId = speech.elevenLabsModelId;
        const shouldQueueViseme =
          ttsEnabled &&
          (ttsProvider === "pocket_tts" || ttsProvider === "elevenlabs");
        const visemeProvider =
          ttsProvider === "pocket_tts" || ttsProvider === "elevenlabs"
            ? ttsProvider
            : undefined;
        const isFinalizedElevenLabsTts = speech.finalizedElevenLabs;

        // 4) Start local run state before opening SSE:
        // - optimistic user message
        // - streaming placeholder
        // - TTS and avatar run start markers
        const runId = genRunId();
        skippedTtsRunIdsRef.current.delete(runId);
        setLocalMessages((prev) =>
          prev.concat({
            id: chatRunMessageId(runId, "user"),
            role: "user",
            text: trimmed,
            animateOnEnter: true,
          }),
        );
        setStreamingRunId(runId);
        setStreamingSegments([]);
        setStreamingDisplayText("");
        streamingSegmentsRef.current = [];
        streamingDisplayTextRef.current = "";
        structuredResponseStateRef.current =
          createStructuredResponseStreamState();
        if (ttsEnabled) {
          startTtsRun(runId);
        }
        startAvatarRun(runId, { inputText: trimmed });
        logger.info("ChatSse", "Starting chat SSE", {
          animaId,
          chatId: resolvedChatId,
          runId,
          inputMode,
          submitReason,
          turnId,
          smartTurnJobId,
          smartTurnScore,
          smartTurnLatencyMs,
          ttsEnabled,
          useMainStructuredResponse,
          ttsProvider,
          elevenLabsModelId,
          shouldQueueViseme,
        });

        let replacedRoute = false;
        let receivedChatTitle = false;
        let voiceStructuredResponseSeen = false;
        let voiceTtsCompleted = false;
        let structuredTtsAppended = false;
        let nonTtsResponseStarted = false;
        let visemeInputsQueued = false;
        let structuredVisemeInputs: AccumulatedStructuredSpeechVisemeInputs | null =
          null;
        const ttsSkippedForRun = (id: string) =>
          skippedTtsRunIdsRef.current.has(id);
        /**
         * Mirrors the pure structured reducer state into the existing React
         * state/refs consumed by displayMessages and completion reconciliation.
         */
        const syncStructuredResponseState = (
          nextState: ReturnType<typeof createStructuredResponseStreamState>,
        ) => {
          structuredResponseStateRef.current = nextState;
          streamingSegmentsRef.current = nextState.speechSegments;
          streamingDisplayTextRef.current = nextState.displayText;
          setStreamingSegments(nextState.speechSegments);
          setStreamingDisplayText(nextState.displayText);
        };
        /**
         * TTS-disabled runs still need the avatar to leave "thinking" once
         * visible assistant output appears. Structured display-only output also
         * counts because it is the user's visible response.
         */
        const maybeMarkNonTtsResponseStarted = (value: string) => {
          if (ttsEnabled || nonTtsResponseStarted || !value.trim()) {
            return;
          }
          markNonTtsResponseStarted(runId);
          nonTtsResponseStarted = true;
        };
        /**
         * Structured speech now streams into TTS as each speech delta arrives.
         * Complete non-delta fallback speech can still append once when no
         * structured TTS text has already been sent.
         */
        const appendStructuredSpeechTts = (
          completedRunId: string,
          payload: StructuredSpeechTtsPayload | null,
        ) => {
          if (
            !payload ||
            !ttsEnabled ||
            voiceTtsCompleted ||
            ttsSkippedForRun(completedRunId)
          ) {
            return;
          }
          appendTtsToken(
            completedRunId,
            payload.text,
            payload.textBasis === "gruut_text_with_ws"
              ? { textBasis: "gruut_text_with_ws" }
              : undefined,
          );
          structuredTtsAppended = true;
        };
        const queueStructuredSpeechVisemeInputs = (
          completedRunId: string,
          payload: StructuredSpeechTtsPayload | null,
          data: {
            tts_phonemized_text?: string[][] | null;
            phonemized_text?: string[][] | null;
            tokenized_text?: string | null;
          },
          fallbackTokenizedText: string,
        ) => {
          if (
            !shouldQueueViseme ||
            !payload ||
            ttsSkippedForRun(completedRunId)
          ) {
            return;
          }

          const visemePayload = selectStructuredSpeechVisemePayload({
            ttsPayload: payload,
            ttsPhonemizedText: data.tts_phonemized_text,
            phonemizedText: data.phonemized_text,
            tokenizedText: data.tokenized_text,
            fallbackTokenizedText,
          });
          if (!visemePayload) return;

          structuredVisemeInputs = appendStructuredSpeechVisemeInputs(
            structuredVisemeInputs,
            visemePayload,
          );
          queueAvatarVisemeInputsForRun({
            runId: completedRunId,
            phonemizedText: structuredVisemeInputs.phonemizedText,
            tokenizedText: structuredVisemeInputs.tokenizedText,
            provider: visemeProvider,
          });
          visemeInputsQueued = true;
        };
        /**
         * Final markers only close the TTS run. They must not re-append the
         * accumulated structured speech, because deltas were already queued.
         */
        const completeStructuredSpeechTts = (completedRunId: string) => {
          if (
            !ttsEnabled ||
            voiceTtsCompleted ||
            ttsSkippedForRun(completedRunId)
          ) {
            return;
          }
          completeTtsRun(completedRunId);
          voiceTtsCompleted = true;
        };
        const maybeReplaceRoute = () => {
          if (!isNewChat || replacedRoute) return;
          void Promise.resolve(replaceChatRoute(resolvedChatId))
            .then(() => {
              logger.info("Routing", "Replaced route after SSE complete", {
                animaId,
                chatId: resolvedChatId,
              });
            })
            .catch((error: unknown) => {
              logger.error(
                "Routing",
                "Failed to replace route after SSE complete",
                error,
              );
            });
          replacedRoute = true;
        };

        // 5) Open chat SSE and reconcile each streamed event type.
        const attachedFileIds = getAttachedFileIds?.() ?? [];
        const resolvedChatRequestOptions = {
          ...(chatRequestOptions ?? {}),
          ...(useMainStructuredResponse
            ? { main_structured_response: true }
            : {}),
          ...(speech.dispatchOptions ?? {}),
        };
        await startChat({
          animaId,
          body: buildChatSseRequestBody({
            message: trimmed,
            runId,
            chatId: resolvedChatId,
            modelProviderId: activeModelProvider?.id,
            runtimeRevision: mountedRuntimeContent.runtimeRevision!,
            attachedFileIds,
            dispatchOptions: resolvedChatRequestOptions,
            requestableNativeTools: activeModelProvider
              ? (activeModelProvider.requestable_native_tool_support ?? [])
              : undefined,
          }),
          onToken: (token, data) => {
            logger.info("Chat", "SSE received token", { token });
            // is_delta controls how this event's text mutates the current part:
            // append for deltas, replace for complete/correction events.
            // part_final is independent; it only means this part is finished,
            // and may arrive on an empty final marker.
            const structuredUpdate = reduceStructuredResponseStream(
              structuredResponseStateRef.current,
              {
                response_part: data.response_part,
                text: token,
                is_delta: data.is_delta,
                part_index: data.part_index,
                part_final: data.part_final,
              },
            );
            if (structuredUpdate.handled) {
              voiceStructuredResponseSeen = true;
              syncStructuredResponseState(structuredUpdate.state);

              // Display is visible-only. It can start the non-TTS avatar
              // response phase, but it must never be submitted to TTS.
              if (structuredUpdate.part === "display") {
                maybeMarkNonTtsResponseStarted(token);
                return;
              }

              const speech = structuredUpdate.state.speechText.trim();
              maybeMarkNonTtsResponseStarted(speech);

              const isDeltaSpeech = data.is_delta === true;
              const ttsPayload = selectStructuredSpeechTtsPayload({
                visibleText: token,
                ttsText: data.tts_text,
                ttsTextBasis: data.tts_text_basis,
                isDelta: isDeltaSpeech,
                structuredTtsAppended,
              });
              queueStructuredSpeechVisemeInputs(
                data.run_id ?? runId,
                ttsPayload,
                {
                  tts_phonemized_text: data.tts_phonemized_text,
                  phonemized_text: data.phonemized_text,
                  tokenized_text: data.tokenized_text,
                },
                token,
              );
              appendStructuredSpeechTts(data.run_id ?? runId, ttsPayload);
              // A final marker can be an empty delta, so completion depends on
              // partFinal rather than token truthiness.
              if (structuredUpdate.partFinal || !isDeltaSpeech) {
                completeStructuredSpeechTts(data.run_id ?? runId);
              }
              return;
            }
            setStreamingSegments((prev) => {
              const next = prev.concat(token);
              streamingSegmentsRef.current = next;
              return next;
            });
            maybeMarkNonTtsResponseStarted(token);
            if (ttsEnabled && !ttsSkippedForRun(runId)) {
              appendTtsToken(runId, token);
            }
          },
          onTtsSession: (data) => {
            const sessionRunId = data.run_id ?? runId;
            if (
              !ttsEnabled ||
              ttsProvider !== "elevenlabs" ||
              ttsSkippedForRun(sessionRunId)
            ) {
              return;
            }
            if (
              typeof data.voice_id !== "string" ||
              typeof data.model_id !== "string" ||
              typeof data.output_format !== "string" ||
              typeof data.sync_alignment !== "boolean" ||
              typeof data.token !== "string"
            ) {
              skippedTtsRunIdsRef.current.add(sessionRunId);
              markElevenLabsSessionFailed(
                sessionRunId,
                "ElevenLabs realtime TTS session data was incomplete.",
              );
              return;
            }
            acceptElevenLabsSession(sessionRunId, {
              voice_id: data.voice_id,
              model_id: data.model_id,
              output_format: data.output_format,
              sync_alignment: data.sync_alignment,
              language_code: data.language_code ?? null,
              token: data.token ?? null,
              websocket_base_url: data.websocket_base_url ?? null,
            });
          },
          onTtsSessionError: (data) => {
            const sessionRunId = data.run_id ?? runId;
            skippedTtsRunIdsRef.current.add(sessionRunId);
            markElevenLabsSessionFailed(sessionRunId, data);
          },
          onTtsAudio: (data) => {
            const audioRunId = data.run_id ?? runId;
            if (
              !ttsEnabled ||
              ttsProvider !== "elevenlabs" ||
              !isFinalizedElevenLabsTts ||
              ttsSkippedForRun(audioRunId)
            ) {
              return;
            }
            acceptElevenLabsFinalizedAudio(audioRunId, data);
          },
          onTtsDone: (data) => {
            const audioRunId = data.run_id ?? runId;
            if (
              !ttsEnabled ||
              ttsProvider !== "elevenlabs" ||
              !isFinalizedElevenLabsTts ||
              ttsSkippedForRun(audioRunId)
            ) {
              return;
            }
            completeElevenLabsFinalizedAudio(audioRunId);
          },
          onTtsError: (data) => {
            const audioRunId = data.run_id ?? runId;
            if (
              !ttsEnabled ||
              ttsProvider !== "elevenlabs" ||
              !isFinalizedElevenLabsTts
            ) {
              return;
            }
            skippedTtsRunIdsRef.current.add(audioRunId);
            markElevenLabsFinalizedAudioFailed(audioRunId, data);
          },
          onEmotionUpdate: (data) => {
            // Full-state emotion updates drive both the live avatar runtime
            // and the persisted anima cache snapshots used elsewhere in the UI.
            applyAvatarEmotionUpdate({
              eventId: data.event_id ?? null,
              runId: data.run_id ?? runId,
              emotions: data.emotions ?? null,
              emotionalTone: data.emotional_tone ?? null,
              emotionalIntensity: data.emotional_intensity ?? null,
            });
            patchAnimaEmotionCaches(data.emotions ?? null);
          },
          onAvatarGestureRequested: (data) => {
            requestAvatarGesture({
              eventId: data.event_id ?? null,
              runId: data.run_id ?? runId,
              gesture: data.gesture ?? null,
            });
          },
          onRuntimeContentRevisionMismatch: () => {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.animaLoadouts.runtime(userKey, animaId),
            });
          },
          onChatTitleUpdated: (data) => {
            const title = data.title?.trim() ?? "";
            const eventChatId = data.chat_id ?? resolvedChatId;
            if (!title || eventChatId !== resolvedChatId) return;
            receivedChatTitle = true;
            patchChatTitleCaches(eventChatId, title, createdChatForTitle);
          },
          onComplete: (data) => {
            // Completion finalizes run side-effects and caches both local user
            // text and fully streamed assistant text into query state.
            const completedRunId = data.run_id ?? runId;
            logger.info("Chat", "SSE run completed", {
              animaId,
              chatId: data.chat_id ?? resolvedChatId,
              runId: completedRunId,
            });
            let assistantTexts = [streamingSegmentsRef.current.join("").trim()]
              .map((value) => value.trim())
              .filter(Boolean);
            if (voiceStructuredResponseSeen) {
              // Structured completion writes speech plus an optional distinct
              // display message. Equal display text is suppressed by the helper.
              assistantTexts = getStructuredAssistantTexts(
                structuredResponseStateRef.current,
              );
            }
            if (
              shouldQueueViseme &&
              !visemeInputsQueued &&
              !ttsSkippedForRun(completedRunId) &&
              Array.isArray(data.phonemized_text) &&
              data.phonemized_text.length
            ) {
              queueAvatarVisemeInputsForRun({
                runId: completedRunId,
                phonemizedText: data.phonemized_text ?? null,
                tokenizedText: data.tokenized_text ?? null,
                provider: visemeProvider,
              });
              visemeInputsQueued = true;
            } else {
              logger.info("Chat", "No viseme inputs queued for completed run", {
                runId: completedRunId,
                shouldQueueViseme,
                ttsEnabled,
                ttsProvider,
                hasPhonemizedText: Array.isArray(data.phonemized_text),
                visemeInputsQueued,
              });
            }
            completeAvatarTurn(completedRunId);
            if (ttsEnabled && !ttsSkippedForRun(completedRunId)) {
              if (voiceStructuredResponseSeen) {
                if (!voiceTtsCompleted) {
                  completeStructuredSpeechTts(completedRunId);
                }
              } else {
                completeTtsRun(completedRunId);
              }
            } else {
              logger.info(
                "Chat",
                "Deferring non-TTS avatar run finish until planner drains",
                {
                  runId: completedRunId,
                },
              );
            }
            skippedTtsRunIdsRef.current.delete(completedRunId);
            maybeReplaceRoute();
            const now = Date.now();
            const userCreatedAt = new Date(now).toISOString();
            const messagesKey = queryKeys.chats.messages(
              userKey,
              resolvedChatId,
            );
            const nextMessages: PyChatMessage[] = [
              {
                chat_id: resolvedChatId,
                run_id: runId,
                role: "user",
                content: trimmed,
                created_at: userCreatedAt,
              },
            ];
            if (assistantTexts.length) {
              assistantTexts.forEach((assistantText, index) => {
                nextMessages.push({
                  chat_id: resolvedChatId,
                  run_id: runId,
                  role: "assistant",
                  content: assistantText,
                  created_at: new Date(now + index + 1).toISOString(),
                });
              });
            } else {
              logger.warn(
                "Chat",
                "No new assistant text to update messages cache with",
              );
            }
            const pendingFinalization = {
              chatId: resolvedChatId,
              messagesKey,
              nextMessages,
              runId: completedRunId,
              requestNonTtsAvatarCompletion: !ttsEnabled,
              refreshChatListsOnComplete: !isNewChat || receivedChatTitle,
            };
            if (assistantTexts.length) {
              setIsAwaitingStreamingAnimationFinalization(true);
              pendingStreamFinalizationRef.current = pendingFinalization;
            } else {
              if (!ttsEnabled) {
                requestNonTtsResponseCompletion(completedRunId);
              }
              finalizeCompletedStream(pendingFinalization);
            }
          },
          onError: (error) => {
            if (error instanceof Error && error.name === "AbortError") {
              abortAvatarRun(runId);
              clearAvatarVisemeBridgeRun(runId, { clearAvatarLipSync: true });
              return;
            }
            if (isRuntimeRemountRequired(error)) {
              const recovery = runtimeRemountRecovery(trimmed);
              interactionStatus = "error";
              cancelTts();
              abortAvatarRun(runId);
              clearAvatarVisemeBridgeRun(runId, {
                clearAvatarLipSync: true,
              });
              clearStreamingState();
              setLocalMessages((messages) =>
                messages.filter(
                  (message) => message.id !== chatRunMessageId(runId, "user"),
                ),
              );
              if (clearInput) setInput(recovery.preserveText);
              toast.error(
                "This Avatar session expired. Reload it, then send your message again.",
                {
                  action: {
                    label: "Reload Avatar Session",
                    onClick: () => {
                      void queryClient
                        .invalidateQueries({
                          queryKey: queryKeys.animaLoadouts.runtime(
                            userKey,
                            animaId,
                          ),
                          refetchType: "none",
                        })
                        .then(() => mountedRuntimeContent.remountLatest());
                    },
                  },
                },
              );
              return;
            }
            // Non-abort errors are surfaced and we tear down all active run
            // side-effects to prevent stale speaking/streaming state.
            interactionStatus = "error";
            logger.error("Chat", "SSE stream error", error);
            cancelTts();
            abortAvatarRun(runId);
            clearAvatarVisemeBridgeRun(runId, { clearAvatarLipSync: true });
            clearStreamingState();
            toast.error("Failed to stream response.");
          },
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          abortAvatarRun();
          clearAvatarVisemeBridgeAll({ clearAvatarLipSync: true });
          return;
        }
        interactionStatus = "error";
        logger.error("Chat", "Failed to send message", error);
        cancelTts();
        abortAvatarRun();
        clearAvatarVisemeBridgeAll({ clearAvatarLipSync: true });
        toast.error("Failed to send message.");
        clearStreamingState();
      } finally {
        const durationMs = performance.now() - startTime;
        recordUiInteractionDuration(durationMs, {
          action: "chat.submit",
          status: interactionStatus,
          input_mode: inputMode,
          submit_reason: submitReason,
        });
      }
    },
    [
      isStreaming,
      animaId,
      acceptElevenLabsFinalizedAudio,
      acceptElevenLabsSession,
      appendTtsToken,
      applyAvatarEmotionUpdate,
      abortAvatarRun,
      cancelTts,
      clearAvatarVisemeBridgeAll,
      clearAvatarVisemeBridgeRun,
      completeAvatarTurn,
      completeElevenLabsFinalizedAudio,
      completeTtsRun,
      markNonTtsResponseStarted,
      anima,
      activeChat,
      activeChatId,
      activeModelProvider,
      createChat,
      chatRequestOptions,
      speech,
      capabilities.chat,
      recordUiInteraction,
      recordUiInteractionDuration,
      markElevenLabsFinalizedAudioFailed,
      markElevenLabsSessionFailed,
      replaceChatRoute,
      routeChatId,
      queueAvatarVisemeInputsForRun,
      requestModelSwitchToNewChat,
      startChat,
      startAvatarRun,
      startTtsRun,
      userKey,
      clearStreamingState,
      finalizeCompletedStream,
      getAttachedFileIds,
      logger,
      patchChatTitleCaches,
      patchAnimaEmotionCaches,
      requestAvatarGesture,
      requestNonTtsResponseCompletion,
      isActiveChatError,
      isActiveChatLoading,
      isModelProvidersLoading,
      mountedRuntimeContent,
      queryClient,
    ],
  );

  // Main submit flow: validates anima context, ensures chat state,
  // starts run-level side effects (avatar/TTS), then streams SSE callbacks.
  const handleSubmit = useCallback(async () => {
    await submitMessage({
      text: input,
      clearInput: true,
      inputMode: "typed",
      submitReason: "manual",
    });
  }, [input, submitMessage]);

  const handleSubmitText = useCallback(
    async (args: {
      text: string;
      inputMode?: InputMode;
      submitReason?: VoiceSubmitReason | "manual";
      turnId?: string | null;
      smartTurnJobId?: string | null;
      smartTurnScore?: number | null;
      smartTurnLatencyMs?: number | null;
      clearInput?: boolean;
    }) => {
      await submitMessage({
        text: args.text,
        clearInput: args.clearInput ?? true,
        inputMode: args.inputMode ?? "typed",
        submitReason: args.submitReason ?? "manual",
        turnId: args.turnId ?? null,
        smartTurnJobId: args.smartTurnJobId ?? null,
        smartTurnScore: args.smartTurnScore ?? null,
        smartTurnLatencyMs: args.smartTurnLatencyMs ?? null,
      });
    },
    [submitMessage],
  );
  return {
    activeChat,
    input,
    setInput,
    animaName,
    inputPlaceholder,
    canChat,
    isStreaming,
    isAwaitingStreamingAnimationFinalization,
    displayMessages,
    handleSubmit,
    handleSubmitText,
    handleStop,
    handleSkipTts,
    isTtsAudioActive,
    handleStreamingAnimationComplete,
    pendingModelSwitch,
    requestModelSwitchToNewChat,
    cancelPendingModelSwitch,
    confirmPendingModelSwitch,
    isConfirmingModelSwitch: updateAnimaChatProfile.isPending,
  };
}
