import { useFormatters } from "@animama/product-ui/i18n";
import { useTranslation } from "react-i18next";

import {
  POCKET_LOADING_STEP_COUNT,
  usePocketTtsRuntime,
} from "@/hooks/use-pocket-tts-runtime";
import { useMountedAnimaRuntimeContent } from "@/ui/app/AnimaRouteProviders";
import {
  modelDownloadLabel,
  useModelDownloads,
  type ModelDownload,
} from "@/ui/app/ModelDownloads";

/**
 * What an Anima chat is still getting ready. Loading reads files this
 * installation already has; only `downloads` fetch from the internet.
 */
export type ChatLoadingStatus = {
  /** The Avatar model has not shown its first posed frame. */
  avatar: boolean;
  /** Gestures, effects and sounds still preparing after the Avatar appears. */
  content: { completed: number; total: number } | null;
  /** The PocketTTS model is loading for its first reply; step is null until its first stage. */
  textToSpeech: { step: number | null; total: number } | null;
  /** Parakeet is loading after a microphone or Voice Mode start. */
  speechToText: boolean;
  /** Speech models downloading from the internet, wherever they were started. */
  downloads: ModelDownload[];
};

/** Collect the chat route's loading items from the stores that already track them. */
export function useChatLoadingStatus({
  isDictationPreparing,
}: {
  isDictationPreparing: boolean;
}): ChatLoadingStatus {
  const mounted = useMountedAnimaRuntimeContent();
  const pocket = usePocketTtsRuntime();
  const downloads = useModelDownloads();
  const preparing = mounted.playbackStatus === "preparing";
  const progress = mounted.preparationProgress;
  return {
    avatar: preparing && mounted.avatarVisualStatus === "loading",
    content:
      preparing && mounted.avatarVisualStatus === "visible"
        ? {
            completed: progress?.completedMembers ?? 0,
            total: progress?.totalMembers ?? 0,
          }
        : null,
    textToSpeech:
      !pocket.ready && pocket.phase === "loading"
        ? { step: pocket.loadingStep, total: POCKET_LOADING_STEP_COUNT }
        : null,
    speechToText: isDictationPreparing,
    downloads,
  };
}

/** One line per pending item, naming its model and whether it loads or downloads. */
export function ChatLoadingStatusLines({
  status,
}: {
  status: ChatLoadingStatus;
}) {
  const { t } = useTranslation("chat");
  const { t: tApp } = useTranslation("app");
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
  if (status.textToSpeech) {
    const { step, total } = status.textToSpeech;
    lines.push({
      key: "tts",
      text:
        step === null
          ? t("loadingStatus.textToSpeech")
          : t("loadingStatus.textToSpeechStep", { step, total }),
    });
  }
  if (status.speechToText)
    lines.push({ key: "stt", text: t("loadingStatus.speechToText") });
  for (const download of status.downloads) {
    const values = {
      item: modelDownloadLabel(tApp, download.item),
      size: formatters.fileSize(download.sizeBytes),
    };
    lines.push({
      key: download.assetId,
      text:
        download.progress === null
          ? t("loadingStatus.download", values)
          : t("loadingStatus.downloadProgress", {
              ...values,
              percent: formatters.number(download.progress, {
                style: "percent",
                maximumFractionDigits: 0,
              }),
            }),
    });
  }
  if (!lines.length) return null;
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
