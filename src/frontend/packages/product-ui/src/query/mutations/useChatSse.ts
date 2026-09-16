import { useProductApiClient } from "../../runtime/ProductRuntimeProvider";

import { useCallback, useEffect, useRef, useState } from "react";

import { chatAnimaDirectSseV1AnimasAnimaIdChatSsePost } from "@animama/runtime-contracts/sdk";
import type { Client } from "@animama/runtime-contracts/sdk";
import type { ChatAnimaDirectSseV1AnimasAnimaIdChatSsePostData } from "@animama/runtime-contracts/api-types";
import type { EmotionValue } from "../../lib/emotion";
import {
  useProductLogger,
  useProductDiagnostics,
} from "../../runtime/diagnostics";

type ChatSseUserResponse = {
  event_id?: string | null;
  run_id?: string | null;
  node_id?: string | null;
  text?: string | null;
  response_format?: string | null;
  response_part?: "speech" | "display" | string | null;
  is_delta?: boolean | null;
  part_index?: number | null;
  part_final?: boolean | null;
  tokenized_text?: string | null;
  phonemized_text?: string[][] | null;
  tts_text?: string | null;
  tts_phonemized_text?: string[][] | null;
  tts_text_basis?: "gruut_text_with_ws" | string | null;
};

type ChatSseRunCompleted = {
  run_id?: string | null;
  chat_id?: string | null;
  tokenized_text?: string | null;
  phonemized_text?: string[][] | null;
};

type ChatSseChatTitleUpdated = {
  type: "chat.title.updated";
  run_id?: string | null;
  chat_id?: string | null;
  title?: string | null;
};

type ChatSseEmotionUpdate = {
  event_id?: string | null;
  run_id?: string | null;
  node_id?: string | null;
  emotions?: EmotionValue[] | null;
  emotional_tone?: string | null;
  emotional_intensity?: number | null;
  promoted_emotion?: string | null;
  demoted_emotion?: string | null;
};

type ChatSseAvatarGestureRequested = {
  event_id?: string | null;
  run_id?: string | null;
  node_id?: string | null;
  gesture?: string | null;
  runtime_revision?: string | null;
};

export type ChatSseTtsSession = {
  type: "tts.session";
  run_id?: string | null;
  provider?: "elevenlabs" | string | null;
  transport?: "direct" | string | null;
  voice_id?: string | null;
  model_id?: string | null;
  output_format?: string | null;
  sync_alignment?: boolean | null;
  language_code?: string | null;
  token?: string | null;
  websocket_base_url?: string | null;
};

export type ChatSseTtsSessionError = {
  type: "tts.session.error";
  run_id?: string | null;
  provider?: "elevenlabs" | string | null;
  error?: string | null;
  code?: string | null;
  status_code?: number | null;
  details?: unknown;
};

export type ChatSseTtsAudio = {
  type: "tts.audio";
  run_id?: string | null;
  provider?: "elevenlabs" | string | null;
  model_id?: string | null;
  output_format?: string | null;
  audio_base64?: string | null;
};

export type ChatSseTtsDone = {
  type: "tts.done";
  run_id?: string | null;
  provider?: "elevenlabs" | string | null;
  model_id?: string | null;
  output_format?: string | null;
};

export type ChatSseTtsError = {
  type: "tts.error";
  run_id?: string | null;
  provider?: "elevenlabs" | string | null;
  model_id?: string | null;
  output_format?: string | null;
  error?: string | null;
  code?: string | null;
};

type ChatSseError = {
  run_id?: string | null;
  error?: string | null;
  code?: string | null;
  details?: unknown;
};

type ChatSseCallbacks = {
  onOpen?: () => void;
  onToken?: (token: string, data: ChatSseUserResponse) => void;
  onEmotionUpdate?: (data: ChatSseEmotionUpdate) => void;
  onAvatarGestureRequested?: (data: ChatSseAvatarGestureRequested) => void;
  onRuntimeContentRevisionMismatch?: (
    data: ChatSseAvatarGestureRequested,
  ) => void;
  onTtsSession?: (data: ChatSseTtsSession) => void;
  onTtsSessionError?: (data: ChatSseTtsSessionError) => void;
  onTtsAudio?: (data: ChatSseTtsAudio) => void;
  onTtsDone?: (data: ChatSseTtsDone) => void;
  onTtsError?: (data: ChatSseTtsError) => void;
  onChatTitleUpdated?: (data: ChatSseChatTitleUpdated) => void;
  onComplete?: (data: ChatSseRunCompleted) => void;
  onError?: (error: unknown) => void;
};

export type ChatSseArgs = ChatSseCallbacks & {
  animaId: string;
  body: ChatAnimaDirectSseV1AnimasAnimaIdChatSsePostData["body"];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isUserResponse(value: unknown): value is ChatSseUserResponse {
  return isObject(value) && "text" in value && typeof value.text === "string";
}

function isRunCompleted(value: unknown): value is ChatSseRunCompleted {
  return (
    isObject(value) &&
    typeof value.run_id === "string" &&
    !("type" in value) &&
    !("text" in value) &&
    !("emotions" in value) &&
    !("gesture" in value) &&
    !("error" in value)
  );
}

function isChatTitleUpdated(value: unknown): value is ChatSseChatTitleUpdated {
  return (
    isObject(value) &&
    value.type === "chat.title.updated" &&
    typeof value.title === "string"
  );
}

function isEmotionUpdate(value: unknown): value is ChatSseEmotionUpdate {
  if (!isObject(value)) return false;
  if (!("emotions" in value)) return false;
  const emotions = (value as ChatSseEmotionUpdate).emotions;
  return emotions === null || emotions === undefined || Array.isArray(emotions);
}

function isAvatarGestureRequested(
  value: unknown,
): value is ChatSseAvatarGestureRequested {
  return isObject(value) && typeof value.gesture === "string";
}

function isTtsSession(value: unknown): value is ChatSseTtsSession {
  return isObject(value) && value.type === "tts.session";
}

function isTtsSessionError(value: unknown): value is ChatSseTtsSessionError {
  return isObject(value) && value.type === "tts.session.error";
}

function isTtsAudio(value: unknown): value is ChatSseTtsAudio {
  return (
    isObject(value) &&
    value.type === "tts.audio" &&
    typeof value.audio_base64 === "string"
  );
}

function isTtsDone(value: unknown): value is ChatSseTtsDone {
  return isObject(value) && value.type === "tts.done";
}

function isTtsError(value: unknown): value is ChatSseTtsError {
  return isObject(value) && value.type === "tts.error";
}

function isErrorEvent(value: unknown): value is ChatSseError {
  return isObject(value) && typeof value.error === "string";
}

function matchesExpectedRunId(
  expectedRunId: string | null,
  eventRunId?: string | null,
): boolean {
  if (!expectedRunId) return true;
  if (!eventRunId) return true;
  return eventRunId === expectedRunId;
}

export function matchesRuntimeContentRevision(
  expectedRevision: string | null,
  eventRevision?: string | null,
): boolean {
  return Boolean(expectedRevision && eventRevision === expectedRevision);
}

export class ChatSseHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly detail: unknown;

  constructor(status: number, statusText: string, body: unknown) {
    super(`SSE failed: ${status} ${statusText}`);
    this.name = "ChatSseHttpError";
    this.status = status;
    this.body = body;
    this.detail = isObject(body) ? body.detail : undefined;
  }
}

async function parseErrorBody(response: Response): Promise<unknown> {
  const text = await response.clone().text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Opens and manages a single active direct chat SSE stream.
 */
export function useChatSse() {
  const client = useProductApiClient();
  const { recordSseStart, recordSseToken, recordSseError, recordSseDuration } =
    useProductDiagnostics();
  const logger = useProductLogger("ChatSse");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      // A host/provider remount must release its owned stream without callbacks.
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  const stop = useCallback(() => {
    logger.info("useChatSse", "Stopping SSE stream");
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, [logger]);

  const startChat = useCallback(
    async (args: ChatSseArgs) => {
      abortRef.current?.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;
      setIsStreaming(true);
      const isActive = () =>
        abortRef.current === abortController && !abortController.signal.aborted;

      const expectedRunId = args.body.run_id ?? null;
      const expectedRuntimeRevision = args.body.runtime_revision;
      const metricAttrs = {
        anima_id: args.animaId,
      };
      const sseStart = performance.now();
      let sseStatus: "ok" | "error" | "cancelled" = "ok";
      let tokenCount = 0;
      let sawRunCompleted = false;

      recordSseStart(metricAttrs);
      logger.info("useChatSse", "Starting chat SSE", {
        animaId: args.animaId,
        runId: expectedRunId,
        chatId: args.body.chat_id,
      });

      try {
        let lastSseError: unknown = null;
        const configuredFetch = client.getConfig().fetch ?? globalThis.fetch;
        const guardedFetch: typeof fetch = async (input, init) => {
          const response = await configuredFetch(input, init);
          if (!isActive()) {
            // Custom transports can resolve after abort; release their late body.
            await response.body?.cancel();
            throw new DOMException("Chat stream cancelled", "AbortError");
          }
          if (!response.ok) {
            throw new ChatSseHttpError(
              response.status,
              response.statusText,
              await parseErrorBody(response),
            );
          }
          return response;
        };
        const sseClient = { post: client.sse.post } as unknown as Client;
        const result = await chatAnimaDirectSseV1AnimasAnimaIdChatSsePost({
          client: sseClient,
          path: { anima_id: args.animaId },
          body: args.body,
          signal: abortController.signal,
          fetch: guardedFetch,
          // A POST stream must never reconnect automatically: the first
          // request may already have reached the model before transport loss.
          sseMaxRetryAttempts: 1,
          onSseError: (error) => {
            lastSseError = error;
          },
          throwOnError: true,
          responseValidator: undefined,
        });

        const { stream } = result as unknown as {
          stream: AsyncGenerator<unknown>;
        };

        if (!isActive()) return;
        args.onOpen?.();
        logger.info("useChatSse", "SSE stream opened", {
          animaId: args.animaId,
          runId: expectedRunId,
        });

        for await (const raw of stream) {
          // A parser may already hold frames when Stop/replacement occurs.
          if (!isActive()) break;
          const data = raw as unknown;

          if (isTtsSession(data)) {
            if (!matchesExpectedRunId(expectedRunId, data.run_id)) {
              continue;
            }
            logger.info("useChatSse", "SSE TTS session", {
              runId: data.run_id,
              provider: data.provider,
              transport: data.transport,
            });
            args.onTtsSession?.(data);
            continue;
          }

          if (isTtsSessionError(data)) {
            if (!matchesExpectedRunId(expectedRunId, data.run_id)) {
              continue;
            }
            logger.warn("useChatSse", "SSE TTS session error", {
              runId: data.run_id,
              provider: data.provider,
              code: data.code,
              statusCode: data.status_code,
              error: data.error,
            });
            args.onTtsSessionError?.(data);
            continue;
          }

          if (isTtsAudio(data)) {
            if (!matchesExpectedRunId(expectedRunId, data.run_id)) {
              continue;
            }
            args.onTtsAudio?.(data);
            continue;
          }

          if (isTtsDone(data)) {
            if (!matchesExpectedRunId(expectedRunId, data.run_id)) {
              continue;
            }
            logger.info("useChatSse", "SSE TTS done", {
              runId: data.run_id,
              provider: data.provider,
              modelId: data.model_id,
            });
            args.onTtsDone?.(data);
            continue;
          }

          if (isTtsError(data)) {
            if (!matchesExpectedRunId(expectedRunId, data.run_id)) {
              continue;
            }
            logger.warn("useChatSse", "SSE TTS error", {
              runId: data.run_id,
              provider: data.provider,
              modelId: data.model_id,
              code: data.code,
              error: data.error,
            });
            args.onTtsError?.(data);
            continue;
          }

          if (isErrorEvent(data)) {
            if (!matchesExpectedRunId(expectedRunId, data.run_id)) continue;
            sseStatus = "error";
            recordSseError(metricAttrs);
            logger.error("useChatSse", "SSE error event", data);
            args.onError?.(data);
            continue;
          }

          if (isEmotionUpdate(data)) {
            if (!matchesExpectedRunId(expectedRunId, data.run_id)) {
              continue;
            }
            logger.info("useChatSse", "SSE emotion update", data);
            args.onEmotionUpdate?.(data);
            continue;
          }

          if (isAvatarGestureRequested(data)) {
            if (!matchesExpectedRunId(expectedRunId, data.run_id)) {
              continue;
            }
            if (
              !matchesRuntimeContentRevision(
                expectedRuntimeRevision,
                data.runtime_revision,
              )
            ) {
              logger.warn(
                "useChatSse",
                "Dropped gesture from a different runtime revision",
                {
                  expectedRuntimeRevision,
                  eventRuntimeRevision: data.runtime_revision ?? null,
                  runId: data.run_id,
                  gesture: data.gesture,
                },
              );
              args.onRuntimeContentRevisionMismatch?.(data);
              continue;
            }
            logger.info("useChatSse", "SSE avatar gesture requested", data);
            args.onAvatarGestureRequested?.(data);
            continue;
          }

          if (isChatTitleUpdated(data)) {
            if (!matchesExpectedRunId(expectedRunId, data.run_id)) {
              continue;
            }
            logger.info("useChatSse", "SSE chat title updated", {
              runId: data.run_id,
              chatId: data.chat_id,
              title: data.title,
            });
            args.onChatTitleUpdated?.(data);
            continue;
          }

          if (isUserResponse(data)) {
            if (!matchesExpectedRunId(expectedRunId, data.run_id)) {
              continue;
            }
            tokenCount += 1;
            recordSseToken(metricAttrs);

            if (tokenCount === 1) {
              logger.info("useChatSse", "Received first token", {
                animaId: args.animaId,
                runId: expectedRunId,
                preview: data.text?.slice(0, 40),
              });
            }

            args.onToken?.(data.text ?? "", data);
            continue;
          }

          if (isRunCompleted(data)) {
            if (!matchesExpectedRunId(expectedRunId, data.run_id)) {
              continue;
            }
            sawRunCompleted = true;
            logger.info("useChatSse", "SSE run completed", {
              animaId: args.animaId,
              runId: expectedRunId,
              chatId: data.chat_id,
              tokenCount,
            });
            if (data.tokenized_text || data.phonemized_text) {
              logger.info("useChatSse", "SSE run completed speech text", {
                animaId: args.animaId,
                runId: expectedRunId,
                tokenizedText: data.tokenized_text ?? null,
                phonemizedText: data.phonemized_text ?? null,
                hasTokenizedText: Boolean(data.tokenized_text?.trim()),
                hasPhonemizedText: Array.isArray(data.phonemized_text),
                phonemizedWordCount: Array.isArray(data.phonemized_text)
                  ? data.phonemized_text.length
                  : 0,
                visemePlanningDeferred: true,
              });
            }
            args.onComplete?.(data);
            break;
          }
        }
        if (lastSseError && !abortController.signal.aborted) {
          throw lastSseError;
        }
        if (!sawRunCompleted && !abortController.signal.aborted) {
          logger.warn("useChatSse", "SSE stream ended without run.completed", {
            animaId: args.animaId,
            runId: expectedRunId,
            tokenCount,
          });
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          sseStatus = "error";
          recordSseError(metricAttrs);
          logger.error("useChatSse", "SSE chat request failed", {
            error,
            animaId: args.animaId,
            runId: expectedRunId,
            chatId: args.body.chat_id,
            tokenCount,
          });
          args.onError?.(error);
        }
      } finally {
        if (abortController.signal.aborted && sseStatus === "ok") {
          sseStatus = "cancelled";
        }

        const wasAborted = abortController.signal.aborted;
        const durationMs = performance.now() - sseStart;
        recordSseDuration(durationMs, { ...metricAttrs, status: sseStatus });

        // A terminal frame (or callback failure) may precede transport EOF.
        // Release that request too, after recording its actual completion status.
        abortController.abort();
        if (abortRef.current === abortController) {
          abortRef.current = null;
          setIsStreaming(false);
        }
        logger.info("useChatSse", "SSE chat request finished", {
          animaId: args.animaId,
          runId: expectedRunId,
          status: sseStatus,
          durationMs,
          tokenCount,
          sawRunCompleted,
          aborted: wasAborted,
        });
      }
    },
    [
      client,
      logger,
      recordSseStart,
      recordSseToken,
      recordSseError,
      recordSseDuration,
    ],
  );

  return { startChat, stop, isStreaming };
}
