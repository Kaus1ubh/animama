import { useProductApiClient } from "@animama/product-ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  PyModelAssetState,
  PyVoiceContent,
} from "@animama/runtime-contracts/api-types";

import {
  prepareVoiceClone,
  voiceCloneNameFromFile,
  type PreparedVoiceClone,
} from "@/lib/speech/pocket/voice-clones";
import {
  ContentSaveApiError,
  parseContentApiErrorDetail,
} from "@/lib/content/contentSaveErrors";
import {
  apiErrorLine,
  apiErrorText,
  readApiError,
} from "@/lib/errors/apiError";
import { useOperatorManagedModelAssets } from "@/query/hooks/useModelAssets";
import { useVoiceCloneActions } from "@/query/mutations/useVoiceCloneActions";
import { useModelAssetAction } from "@/query/mutations/useModelAssetActions";
import {
  PocketVoiceEncoderDownloadRequired,
  POCKET_VOICE_ENCODER_ASSET_ID,
} from "@/lib/speech/pocket/voice-cloning-encoder";
import { VoiceCloningDownload } from "./VoiceCloningDownload";
import { Button } from "@/ui/components/button";
import { OPERATOR_MANAGED_MODELS_NOTE } from "@/ui/settings/operator-managed-models";
import { Input } from "@/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";

/**
 * Text for a failed clone operation. The in-use and changed codes have voice
 * wording; other content save failures arrive worded (`toContentSaveApiError`);
 * any other English stays primary in English and is secondary detail under
 * `fallback` elsewhere.
 */
function cloneError(
  t: TFunction<"animas">,
  error: unknown,
  fallback: string,
): string {
  const code =
    error instanceof ContentSaveApiError
      ? error.code
      : parseContentApiErrorDetail(error)?.code;
  if (code === "catalog_item_in_use") return t("voices.cloning.errors.inUse");
  if (code === "catalog_revision_conflict")
    return t("voices.cloning.errors.changed");
  if (error instanceof ContentSaveApiError) return error.message;
  return apiErrorLine(apiErrorText(readApiError(error), null, fallback));
}

/** Named originals and encoded voices are saved together, independently of selection. */
export function VoiceCloneLibrary({
  disabled,
  heading = true,
  deleting,
  onDeleteClose,
  onBusyChange,
}: {
  disabled: boolean;
  heading?: boolean;
  deleting: PyVoiceContent | null;
  onDeleteClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const apiClient = useProductApiClient();
  const { t } = useTranslation("animas");

  const actions = useVoiceCloneActions();
  const modelAction = useModelAssetAction();
  const operatorManaged = useOperatorManagedModelAssets();
  const input = useRef<HTMLInputElement>(null);
  const prepared = useRef<PreparedVoiceClone | null>(null);
  const pending = useRef(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [encoderOpen, setEncoderOpen] = useState(false);
  const [encoder, setEncoder] = useState<PyModelAssetState | null>(null);
  const [encoderError, setEncoderError] = useState<string | null>(null);
  const [cancellingDownload, setCancellingDownload] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const reportBusy = useRef(onBusyChange);
  useEffect(() => {
    reportBusy.current = onBusyChange;
  }, [onBusyChange]);
  useEffect(
    () => () => {
      if (operation.current) {
        operation.current.abort();
        reportBusy.current(false);
      }
    },
    [],
  );
  const locked = disabled || busy;
  const changeBusy = (value: boolean) => {
    pending.current = value;
    setBusy(value);
    onBusyChange(value);
  };

  const save = async (download = false) => {
    if (locked || pending.current || !file) return;
    const controller = new AbortController();
    operation.current = controller;
    let waitingForEncoder = download;
    changeBusy(true);
    setError(null);
    setEncoderError(null);
    try {
      if (!prepared.current) {
        if (download) {
          // Existing mutation updates the shared query before the local waiter
          // joins, so other open setup/settings views see this installation.
          const asset = await modelAction.mutateAsync({
            action: "install",
            assetId: POCKET_VOICE_ENCODER_ASSET_ID,
          });
          controller.signal.throwIfAborted();
          setEncoder(asset);
        }
        setStatus(t("voices.cloning.checking"));
        const next = await prepareVoiceClone(apiClient, {
          name: name.trim(),
          file,
          encoder: {
            signal: controller.signal,
            onState: (asset) => {
              waitingForEncoder = asset.status !== "installed";
              setEncoder(asset);
              if (asset.status === "downloading") {
                setEncoderOpen(true);
                setStatus(t("voices.cloning.downloading"));
              } else if (asset.status === "installed") {
                setEncoderOpen(false);
                setStatus(t("voices.cloning.cloningVoice"));
              }
            },
          },
        });
        controller.signal.throwIfAborted();
        prepared.current = next;
      }
      controller.signal.throwIfAborted();
      setStatus(t("voices.cloning.savingVoice"));
      await actions.saveVoiceClone.mutateAsync(prepared.current);
      controller.signal.throwIfAborted();
      prepared.current = null;
      setName("");
      setFile(null);
      toast.success(t("voices.cloning.saved"));
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof PocketVoiceEncoderDownloadRequired) {
        if (operatorManaged) {
          // The operator provides the encoder; this runtime never downloads it.
          setError(
            t("voices.cloning.operatorManaged", {
              note: OPERATOR_MANAGED_MODELS_NOTE,
            }),
          );
        } else {
          setEncoder(cause.asset);
          if (cause.asset.status === "failed") setEncoderError(cause.message);
          setEncoderOpen(true);
        }
      } else {
        const message = cloneError(
          t,
          cause,
          t("voices.cloning.errors.saveFailed"),
        );
        if (waitingForEncoder) {
          setEncoderError(message);
          setEncoderOpen(true);
        } else setError(message);
      }
    } finally {
      if (operation.current === controller && !controller.signal.aborted) {
        operation.current = null;
        setStatus(null);
        changeBusy(false);
      }
    }
  };

  const closeEncoder = () => {
    operation.current?.abort();
    operation.current = null;
    setEncoderOpen(false);
    setCancellingDownload(false);
    setStatus(null);
    changeBusy(false);
  };

  const cancelDownload = async () => {
    // Stop this operation before awaiting removal, so a download that finishes
    // during cancellation cannot continue into encoding or saving the sample.
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    changeBusy(true);
    setCancellingDownload(true);
    try {
      // This explicit action is global; closing or unmounting never removes bytes.
      const asset = await modelAction.mutateAsync({
        action: "remove",
        assetId: POCKET_VOICE_ENCODER_ASSET_ID,
      });
      controller.signal.throwIfAborted();
      setEncoder(asset);
      setEncoderError(t("voices.cloning.errors.cancelled"));
      setStatus(null);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setEncoderError(
        cloneError(t, cause, t("voices.cloning.errors.cancelFailed")),
      );
    } finally {
      if (operation.current === controller && !controller.signal.aborted) {
        operation.current = null;
        setCancellingDownload(false);
        changeBusy(false);
      }
    }
  };

  const remove = async () => {
    if (!deleting || locked || pending.current) return;
    changeBusy(true);
    setDialogError(null);
    try {
      await actions.deleteVoiceClone.mutateAsync(deleting);
      onDeleteClose();
      toast.success(t("voices.cloning.deleted"));
    } catch (cause) {
      setDialogError(
        cloneError(t, cause, t("voices.cloning.errors.deleteFailed")),
      );
    } finally {
      changeBusy(false);
    }
  };

  return (
    <section
      className="space-y-3"
      aria-label={t("voices.cloning.sectionLabel")}
    >
      {heading ? (
        <h3 className="pt-3 text-sm font-semibold">
          {t("voices.cloning.title")}
        </h3>
      ) : null}
      <form
        className="space-y-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void save();
        }}
      >
        <Input
          id="voice-clone-name"
          aria-label={t("voices.cloning.nameLabel")}
          value={name}
          placeholder={t("voices.cloning.namePlaceholder")}
          maxLength={120}
          disabled={locked}
          onChange={(event) => {
            setName(event.target.value);
            prepared.current = null;
            setError(null);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={locked}
            onClick={() => input.current?.click()}
          >
            {file ? t("voices.cloning.change") : t("voices.cloning.upload")}
          </Button>
          <span
            className="text-muted-foreground min-w-0 flex-1 truncate text-xs"
            title={file?.name}
          >
            {file?.name}
          </span>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={locked || !file}
          >
            {t("voices.cloning.clone")}
          </Button>
          <input
            ref={input}
            type="file"
            accept=".wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg"
            className="hidden"
            aria-label={t("voices.cloning.fileLabel")}
            onChange={(event) => {
              const next = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (next) {
                setFile(next);
                if (!name.trim()) setName(voiceCloneNameFromFile(next.name));
                prepared.current = null;
                setError(null);
              }
            }}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {t("voices.cloning.hint")}
        </p>
        {status ? (
          <p role="status" className="text-muted-foreground text-xs">
            {status}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        ) : null}
      </form>
      <Dialog
        open={encoderOpen}
        onOpenChange={(open) => {
          if (!open) closeEncoder();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("voices.cloning.download.title")}</DialogTitle>
            <DialogDescription>
              {t("voices.cloning.download.description")}
            </DialogDescription>
          </DialogHeader>
          {encoder ? (
            <VoiceCloningDownload
              asset={encoder}
              sampleName={file?.name ?? t("voices.cloning.sampleFallback")}
              error={encoderError}
              busy={busy}
              cancelling={cancellingDownload}
              onDownload={() => void save(true)}
              onCancelDownload={() => void cancelDownload()}
              onClose={closeEncoder}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDialogError(null);
            onDeleteClose();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("voices.cloning.delete.title", { name: deleting?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {t("voices.cloning.delete.description")}
            </DialogDescription>
          </DialogHeader>
          {dialogError ? (
            <p role="alert" className="text-destructive text-sm">
              {dialogError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDialogError(null);
                onDeleteClose();
              }}
            >
              {t("actions.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              {t("voices.cloning.delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
