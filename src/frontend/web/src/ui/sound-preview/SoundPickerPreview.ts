import type { Client } from "@animama/runtime-contracts/sdk";
import { getI18n } from "react-i18next";
import { previewCatalogItem } from "@/lib/content/catalogApi";
import {
  contentPreviewPrimaryFile,
  fetchContentPreviewFile,
} from "@/lib/content/contentPreview";
import {
  apiErrorLine,
  apiErrorText,
  readApiError,
  WordedError,
} from "@/lib/errors/apiError";

/** Text for a failed audition; English without wording follows the uncoded-error rule. */
function previewErrorText(error: unknown): string {
  const t = getI18n().getFixedT(null, "sound");
  return apiErrorLine(
    apiErrorText(readApiError(error), null, t("preview.playFailed")),
  );
}

/** Own a single picker audition, including requests that finish after cancellation. */
export class SoundPickerPreview {
  private request: AbortController | null = null;
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;

  /** Reports the auditioned item, or a failure worded in the UI Locale. */
  private readonly changed: (id: string | null, error?: string) => void;

  constructor(changed: (id: string | null, error?: string) => void) {
    this.changed = changed;
  }

  stop(): void {
    this.request?.abort();
    this.request = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio = null;
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.changed(null);
  }

  async play(apiClient: Client, itemId: string): Promise<void> {
    this.stop();
    const request = new AbortController();
    this.request = request;
    this.changed(itemId);
    try {
      const preview = await previewCatalogItem(
        apiClient,
        itemId,
        request.signal,
        "sound_effect",
      );
      if (request.signal.aborted) return;
      const t = getI18n().getFixedT(null, "sound");
      const file = contentPreviewPrimaryFile(preview, "audio");
      if (!file) throw new WordedError(t("preview.noAudio"));
      const response = await fetchContentPreviewFile(preview, file, {
        signal: request.signal,
      });
      if (!response.ok) throw new WordedError(t("preview.loadFailed"));
      const blob = await response.blob();
      if (request.signal.aborted) return;
      this.url = URL.createObjectURL(blob);
      const audio = new Audio(this.url);
      this.audio = audio;
      audio.onended = () => this.stop();
      audio.onerror = () => {
        if (request.signal.aborted) return;
        this.stop();
        this.changed(null, t("preview.playFailed"));
      };
      await audio.play();
      if (request.signal.aborted) audio.pause();
    } catch (error) {
      if (request.signal.aborted) return;
      this.stop();
      this.changed(null, previewErrorText(error));
    }
  }
}
