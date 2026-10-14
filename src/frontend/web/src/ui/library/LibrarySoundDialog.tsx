import { useProductApiClient } from "@animama/product-ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { useContentEditorSaveSource } from "@/hooks/useContentEditorSaveSource";
import { useContentSaveFailure } from "@/hooks/useContentSaveFailure";
import {
  deleteCatalogItem,
  getCatalogItem,
  previewCatalogItem,
  saveCatalogItem,
  type CatalogSaveInput,
} from "@/lib/content/catalogApi";
import type { PyCatalogViewItem } from "@/lib/content/catalogTypes";
import { loadCreatorPreviewFile } from "@/lib/content/contentEditorSource";
import { queryKeys } from "@/query/keys";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { Input } from "@/ui/components/input";
import { librarySoundSaveInput } from "./librarySoundSave";
import { WordedError } from "@/lib/errors/apiError";

/** A Library edit pins revision authority and retains its receipt across uncertain retries. */
export function LibrarySoundDialog({
  item,
  onClose,
}: {
  item: PyCatalogViewItem;
  onClose: () => void;
}) {
  const apiClient = useProductApiClient();
  const { t } = useTranslation("library");

  const [name, setName] = useState(item.name);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const request = useRef<CatalogSaveInput | null>(null);
  const mounted = useRef(true);
  const owner = useRuntimeCacheKey();
  const queryClient = useQueryClient();
  const { saved: recordSaved } = useContentEditorSaveSource(
    "sound_effect",
    item.item_id,
    item,
  );
  const { capture, clear, error } = useContentSaveFailure();
  const editable = item.origin === "owned";
  const changed = name.trim() !== item.name || file !== null;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    clear();
    try {
      if (!request.current) {
        // Typed rows omit sidecar provenance and other hidden fields. Read the
        // original metadata without advancing this dialog's revision authority.
        const stored = await getCatalogItem(apiClient, item.item_id);
        if (stored.revision_sha256 !== item.revision_sha256)
          throw new WordedError(t("sound.changed"));
        const audio =
          file ??
          (await loadCreatorPreviewFile(
            await previewCatalogItem(
              apiClient,
              item.item_id,
              undefined,
              "sound_effect",
            ),
            "audio",
          ));
        if (!mounted.current) return;
        request.current = librarySoundSaveInput(
          { ...item, metadata: stored.metadata },
          name,
          audio,
          crypto.randomUUID(),
        );
      }
      const result = await saveCatalogItem(apiClient, request.current);
      // A successful write must never be retried because cache refresh failed.
      setSaved(true);
      await recordSaved(result);
      onClose();
    } catch (cause) {
      if (mounted.current) capture(cause);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const remove = async () => {
    if (!item.revision_sha256) return;
    setBusy(true);
    clear();
    try {
      await deleteCatalogItem(apiClient, item.item_id, item.revision_sha256);
      if (owner)
        void queryClient.invalidateQueries({
          queryKey: queryKeys.soundEffects.all(owner),
        });
      onClose();
    } catch (cause) {
      capture(cause);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("sound.title")}</DialogTitle>
          <DialogDescription>
            {editable ? t("sound.description") : t("sound.readOnly")}
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-2 text-sm">
          {t("sound.name")}
          <Input
            value={name}
            maxLength={120}
            disabled={!editable || busy || saved}
            onChange={(event) => {
              setName(event.target.value);
              request.current = null;
              clear();
            }}
          />
        </label>
        {editable ? (
          <label className="grid gap-2 text-sm">
            {t("sound.replaceAudio")}
            <span className="text-muted-foreground text-xs">
              {t("sound.sameFormat")}
            </span>
            <Input
              type="file"
              accept=".wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg"
              disabled={busy || saved}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                request.current = null;
                clear();
              }}
            />
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        {editable ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="destructive"
              disabled={busy || saved || !item.revision_sha256}
              onClick={() => setConfirmDelete(true)}
            >
              {t("sound.delete")}
            </Button>
            <Button
              disabled={
                busy ||
                saved ||
                !name.trim() ||
                !changed ||
                !item.revision_sha256
              }
              onClick={() => void save()}
            >
              {busy ? t("sound.saving") : t("sound.save")}
            </Button>
          </div>
        ) : null}
        {confirmDelete ? (
          <div className="grid gap-3 rounded-md border p-3">
            <p className="text-sm">
              {t("sound.confirmDeleteQuestion", { name: item.name })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void remove()}
              >
                {t("sound.confirmDelete")}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
              >
                {t("sound.cancel")}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
