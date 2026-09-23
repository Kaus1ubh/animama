import { previewCatalogItem } from "@/lib/content/catalogApi";
import {
  contentPreviewPrimaryFile,
  fetchContentPreviewFile,
} from "@/lib/content/contentPreview";

/** Own a single picker audition, including requests that finish after cancellation. */
export class SoundPickerPreview {
  private request: AbortController | null = null;
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;

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

  async play(itemId: string): Promise<void> {
    this.stop();
    const request = new AbortController();
    this.request = request;
    this.changed(itemId);
    try {
      const preview = await previewCatalogItem(
        itemId,
        request.signal,
        "sound_effect",
      );
      if (request.signal.aborted) return;
      const file = contentPreviewPrimaryFile(preview, "audio");
      if (!file) throw new Error("This sound has no playable audio.");
      const response = await fetchContentPreviewFile(preview, file, {
        signal: request.signal,
      });
      if (!response.ok) throw new Error("Sound preview could not be loaded.");
      const blob = await response.blob();
      if (request.signal.aborted) return;
      this.url = URL.createObjectURL(blob);
      const audio = new Audio(this.url);
      this.audio = audio;
      audio.onended = () => this.stop();
      audio.onerror = () => {
        if (request.signal.aborted) return;
        this.stop();
        this.changed(null, "Sound preview could not be played.");
      };
      await audio.play();
      if (request.signal.aborted) audio.pause();
    } catch (error) {
      if (request.signal.aborted) return;
      this.stop();
      this.changed(
        null,
        error instanceof Error
          ? error.message
          : "Sound preview could not be played.",
      );
    }
  }
}
