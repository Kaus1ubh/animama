import { useFormatters } from "@animama/product-ui/i18n";
import { useTranslation } from "react-i18next";

import { usePocketTtsRuntime } from "@/hooks/use-pocket-tts-runtime";
import { usePocketVoiceDownloads } from "@/hooks/use-pocket-voice-downloads";
import { POCKET_VOICES } from "@/lib/speech/pocket/voice-catalog";
import { useMountedAnimaRuntimeContent } from "@/ui/app/AnimaRouteProviders";

/**
 * What an Anima chat is still getting ready. Loading reads files this
 * installation already has; only `voiceDownload` fetches from the internet.
 */
export type ChatLoadingStatus = {
  /** The Avatar model has not shown its first posed frame. */
  avatar: boolean;
  /** Gestures, effects and sounds still preparing after the Avatar appears. */
  content: { completed: number; total: number } | null;
  /** The PocketTTS model is loading for its first reply. */
  textToSpeech: boolean;
  /** Parakeet is loading after a microphone or Voice Mode start. */
  speechToText: boolean;
  /** A Pocket voice installing through the backend downloader. */
  voiceDownload: {
    name: string;
    sizeBytes: number;
    progress: number | null;
  } | null;
};

/** Collect the chat route's loading items from the stores that already track them. */
export function useChatLoadingStatus({
  isDictationPreparing,
}: {
  isDictationPreparing: boolean;
}): ChatLoadingStatus {
  const mounted = useMountedAnimaRuntimeContent();
  const pocket = usePocketTtsRuntime();
  // Chat playback owns the model-asset query and its polling; this observer
  // only reads that cache, so it adds no requests.
  const { availability } = usePocketVoiceDownloads({ enabled: false });
  const preparing = mounted.playbackStatus === "preparing";
  const progress = mounted.preparationProgress;
  const downloading = POCKET_VOICES.find(
    (voice) => availability(voice.id)?.status === "downloading",
  );
  return {
    avatar: preparing && mounted.avatarVisualStatus === "loading",
    content:
      preparing && mounted.avatarVisualStatus === "visible"
        ? {
            completed: progress?.completedMembers ?? 0,
            total: progress?.totalMembers ?? 0,
          }
        : null,
    textToSpeech: !pocket.ready && pocket.phase === "loading",
    speechToText: isDictationPreparing,
    voiceDownload: downloading
      ? {
          name: downloading.name,
          sizeBytes: downloading.sizeBytes,
          progress: availability(downloading.id)?.progress ?? null,
        }
      : null,
  };
}

/** One line per pending item, naming its model and whether it loads or downloads. */
export function ChatLoadingStatusLines({
  status,
  canChat,
}: {
  status: ChatLoadingStatus;
  canChat: boolean;
}) {
  const { t } = useTranslation("chat");
  const formatters = useFormatters();
  const lines: { key: string; text: string }[] = [];
  if (status.avatar)
    lines.push({ key: "avatar", text: t("loadingStatus.avatar") });
  if (status.content)
    lines.push({
      key: "content",
      text:
        status.content.total > 0
          ? t("loadingStatus.contentProgress", status.content)
          : t("loadingStatus.content"),
    });
  if (status.textToSpeech)
    lines.push({ key: "tts", text: t("loadingStatus.textToSpeech") });
  if (status.speechToText)
    lines.push({ key: "stt", text: t("loadingStatus.speechToText") });
  const download = status.voiceDownload;
  if (download) {
    const values = {
      name: download.name,
      size: formatters.fileSize(download.sizeBytes),
    };
    lines.push({
      key: "voiceDownload",
      text:
        download.progress === null
          ? t("loadingStatus.voiceDownload", values)
          : t("loadingStatus.voiceDownloadProgress", {
              ...values,
              percent: formatters.number(download.progress, {
                style: "percent",
                maximumFractionDigits: 0,
              }),
            }),
    });
  }
  if (!lines.length) return null;
  if (canChat) lines.push({ key: "canChat", text: t("loadingStatus.canChat") });
  return (
    <div
      className="text-muted-foreground mb-2 space-y-0.5 px-1 text-xs"
      role="status"
    >
      {lines.map((line) => (
        <p key={line.key}>{line.text}</p>
      ))}
    </div>
  );
}
