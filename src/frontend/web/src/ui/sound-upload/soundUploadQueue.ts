import { getI18n } from "react-i18next";

import type { PyContentItem } from "@/lib/content/catalogTypes";
import type { CatalogSaveInput } from "@/lib/content/catalogApi";
import {
  ContentSaveApiError,
  contentSaveFieldError,
  toContentSaveApiError,
} from "@/lib/content/contentSaveErrors";
import { createUniqueContentName } from "@/lib/content/uniqueContentName";
import { apiErrorLine, uncodedErrorText } from "@/lib/errors/apiError";

export const SOUND_UPLOAD_ACCEPT = ".wav,.mp3,.ogg";
export type SoundUploadEntry = {
  id: string;
  file: File;
  name: string;
  status: "queued" | "uploading" | "saved" | "error";
  /** Why the save failed, worded in the UI Locale. */
  error?: string;
  /** Why the catalog refresh after a save failed, worded in the UI Locale. */
  notificationError?: string;
  item?: PyContentItem;
};
export type SoundUploadServices = {
  listNames: () => Promise<string[]>;
  save: (input: CatalogSaveInput) => Promise<PyContentItem>;
  onSaved: (item: PyContentItem) => void | Promise<void>;
};

/**
 * Text for a failed save: content save failures arrive worded; other English
 * is shown in English and as detail under a translated message elsewhere.
 */
function saveErrorText(error: unknown): string {
  if (error instanceof ContentSaveApiError) return error.message;
  if (!(error instanceof Error)) return toContentSaveApiError(error).message;
  const t = getI18n().getFixedT(null, "sound");
  return apiErrorLine(uncodedErrorText(error.message, t("upload.failed")));
}

/** Independent saves survive partial failure; retries retain exact request identity. */
export class SoundUploadQueue {
  entries: SoundUploadEntry[] = [];
  private allocated = new Set<string>();
  private pending: Promise<void> = Promise.resolve();

  private services: SoundUploadServices;
  private changed: () => void;

  constructor(services: SoundUploadServices, changed: () => void) {
    this.services = services;
    this.changed = changed;
  }

  add(files: File[]) {
    const t = getI18n().getFixedT(null, "sound");
    const added: SoundUploadEntry[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name.replace(/\.[^.]+$/, "").trim() || t("upload.defaultName"),
      status: "queued",
    }));
    this.entries.push(...added);
    this.changed();
    return this.schedule(added);
  }

  retry(id: string) {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry || entry.status !== "error") return Promise.resolve();
    entry.status = "queued";
    entry.error = undefined;
    this.changed();
    return this.schedule([entry]);
  }

  /** Retry only catalog notification after an acknowledged save, never its upload. */
  async refresh(id: string) {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry?.item || entry.status !== "saved") return;
    try {
      await this.services.onSaved(entry.item);
      entry.notificationError = undefined;
    } catch (error) {
      const t = getI18n().getFixedT(null, "sound");
      const message = apiErrorLine(
        uncodedErrorText(
          error instanceof Error ? error.message : null,
          t("upload.refreshFailed"),
        ),
      );
      entry.notificationError = t("upload.savedRefreshFailed", { message });
    }
    this.changed();
  }

  private schedule(entries: SoundUploadEntry[]) {
    this.pending = this.pending.then(async () => {
      for (const entry of entries) await this.upload(entry);
    });
    return this.pending;
  }

  private async upload(entry: SoundUploadEntry) {
    entry.status = "uploading";
    this.changed();
    try {
      if (!/\.(wav|mp3|ogg)$/i.test(entry.file.name)) {
        const t = getI18n().getFixedT(null, "sound");
        throw contentSaveFieldError(t("upload.unsupportedType"), "files");
      }
      if (!this.allocated.has(entry.id)) {
        const names = await this.services.listNames();
        const existingNames = [
          ...names,
          ...this.entries
            .filter((candidate) => this.allocated.has(candidate.id))
            .map((candidate) => candidate.name),
        ];
        let base = entry.name.slice(0, 120);
        let name = createUniqueContentName(base, existingNames);
        while (name.length > 120) {
          base = base.slice(0, base.length - (name.length - 120));
          name = createUniqueContentName(base, [...existingNames, base]);
        }
        entry.name = name;
        this.allocated.add(entry.id);
      }
      const saved = await this.services.save({
        kind: "sound_effect",
        // Portable storage names need not restrict Unicode display filenames.
        entryName: `sound-${entry.id}`,
        operationId: entry.id,
        files: [entry.file],
        metadata: {
          schema_version: 1,
          id: `local:sound-effect:${entry.id}`,
          name: entry.name,
          defaults: { volume: 1 },
        },
      });
      entry.item = saved;
      entry.status = "saved";
    } catch (error) {
      entry.status = "error";
      entry.error = saveErrorText(error);
    }
    this.changed();
    // A callback/cache failure cannot turn an acknowledged save into a retry.
    if (entry.item) await this.refresh(entry.id);
  }
}
