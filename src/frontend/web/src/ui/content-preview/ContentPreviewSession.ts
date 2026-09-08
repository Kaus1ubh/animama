import type { PyContentPreview } from "@/lib/content/catalogTypes";

/** Owns one prepared component preview and rejects stale async results. */
export class ContentPreviewSession {
  #generation = 0;
  #preview: PyContentPreview | null = null;

  begin(): number {
    this.#generation += 1;
    this.#preview = null;
    return this.#generation;
  }

  commit(generation: number, preview: PyContentPreview): boolean {
    if (generation !== this.#generation) return false;
    this.#preview = preview;
    return true;
  }

  clear(): void {
    this.#generation += 1;
    this.#preview = null;
  }

  get preview(): PyContentPreview | null {
    return this.#preview;
  }
}
