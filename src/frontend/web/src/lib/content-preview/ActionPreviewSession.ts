import type { PyActionPreview } from "@/lib/content/catalogTypes";
import { WordedError } from "@/lib/errors/apiError";
import { getI18n } from "react-i18next";

export type ActionPreviewClosure = {
  root: Record<string, unknown>;
  supports: Array<Record<string, unknown>>;
  revision: string;
  diagnostics: Array<Record<string, unknown>>;
};

/** Owns one dependency-complete preview and rejects cancelled/stale requests. */
export class ActionPreviewSession {
  #generation = 0;
  #preview: PyActionPreview | null = null;
  #controller: AbortController | null = null;

  begin(): { generation: number; signal: AbortSignal } {
    this.#controller?.abort();
    this.#generation += 1;
    const controller = new AbortController();
    this.#controller = controller;
    const generation = this.#generation;
    controller.signal.addEventListener("abort", () => {
      if (generation === this.#generation) this.#preview = null;
    });
    return { generation, signal: controller.signal };
  }

  commit(generation: number, preview: PyActionPreview): boolean {
    if (generation !== this.#generation) return false;
    actionClosure(preview);
    this.#preview = preview;
    return true;
  }

  clear(): void {
    this.#controller?.abort();
    this.#controller = null;
    this.#generation += 1;
    this.#preview = null;
  }

  get preview(): PyActionPreview | null {
    return this.#preview;
  }
}

/** Validate the server's open JSON closure before it reaches playback code. */
export function actionClosure(preview: PyActionPreview): ActionPreviewClosure {
  const t = getI18n().getFixedT(null, "actionEditor");
  const value = preview.closure;
  if (
    !value ||
    typeof value !== "object" ||
    !value.root ||
    typeof value.root !== "object" ||
    !Array.isArray(value.supports) ||
    typeof value.revision !== "string"
  ) {
    throw new WordedError(t("preview.errors.invalidClosure"));
  }
  return {
    root: value.root as Record<string, unknown>,
    supports: value.supports as Array<Record<string, unknown>>,
    revision: value.revision,
    diagnostics: Array.isArray(value.diagnostics)
      ? (value.diagnostics as Array<Record<string, unknown>>)
      : [],
  };
}
