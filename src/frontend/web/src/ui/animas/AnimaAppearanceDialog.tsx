"use client";

import { LoaderCircle, RotateCcw, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PyRuntimeImageReference } from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { getContentUploadErrorPresentation } from "@/lib/content/contentUploads";
import { ContentSaveApiError } from "@/lib/content/contentSaveErrors";
import { useContentSaveFailure } from "@/hooks/useContentSaveFailure";
import { cn } from "@/lib/utils";
import { useAnimaLoadout } from "@/query/hooks/useAnimaLoadout";
import { useAnimaPresentationImage } from "@/query/hooks/useAnimaPresentationImage";
import { useAppearanceImagePreview } from "@/query/hooks/useAppearanceImagePreview";
import { useAppearanceImages } from "@/query/hooks/useAppearanceImages";
import { queryKeys } from "@/query/keys";
import { useAnimaLoadoutMutations } from "@/query/mutations/useAnimaLoadoutMutations";
import { useAppearanceContentActions } from "@/query/mutations/useAppearanceContentActions";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { RuntimeImageCropEditor } from "@/ui/components/runtime-image-frame";
import { Slider } from "@/ui/components/slider";
import { ContentHealth } from "@/ui/content-health/ContentHealth";

export type AnimaAppearanceSection = "profile_image" | "background_image";

type AppearanceConfig = {
  fit: "cover" | "contain";
  focal_x: number;
  focal_y: number;
  zoom: number;
};
type AppearanceDraft = { itemId: string; config: AppearanceConfig };
type PendingUpload = { file: File; operationId: string };

const SECTION_LABELS: Record<AnimaAppearanceSection, string> = {
  profile_image: "Profile",
  background_image: "Background",
};
const DEFAULT_CONFIG: AppearanceConfig = {
  fit: "cover",
  focal_x: 0.5,
  focal_y: 0.5,
  zoom: 1,
};

function normalizeConfig(
  value: Record<string, unknown> | undefined,
): AppearanceConfig {
  return {
    fit: value?.fit === "contain" ? "contain" : "cover",
    focal_x: Math.min(1, Math.max(0, Number(value?.focal_x ?? 0.5))),
    focal_y: Math.min(1, Math.max(0, Number(value?.focal_y ?? 0.5))),
    zoom: Math.min(4, Math.max(1, Number(value?.zoom ?? 1))),
  };
}

function imageName(filename: string) {
  const dot = filename.lastIndexOf(".");
  return (dot > 0 ? filename.slice(0, dot) : filename).trim() || "Anima image";
}

function sectionUse(section: AnimaAppearanceSection): "profile" | "background" {
  return section === "background_image" ? "background" : "profile";
}

/** Header-owned Appearance selection and direct Local image Save flow. */
export function AnimaAppearanceDialog({
  animaId,
  animaName,
  profileThumbnail,
  section,
  onSectionChange,
  onOpenChange,
}: {
  animaId: string;
  animaName: string;
  profileThumbnail: PyRuntimeImageReference | null;
  section: AnimaAppearanceSection | null;
  onSectionChange: (section: AnimaAppearanceSection) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const open = section !== null;
  const activeSection = section ?? "profile_image";
  const use = sectionUse(activeSection);
  const userId = useRuntimeOwnerId() ?? "__anon__";
  const queryClient = useQueryClient();
  const loadout = useAnimaLoadout(animaId);
  const images = useAppearanceImages();
  const mutations = useAnimaLoadoutMutations(animaId);
  const contentActions = useAppearanceContentActions();
  const fileInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [drafts, setDrafts] = useState<
    Record<AnimaAppearanceSection, AppearanceDraft>
  >({
    profile_image: { itemId: "", config: DEFAULT_CONFIG },
    background_image: { itemId: "", config: DEFAULT_CONFIG },
  });
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(
    null,
  );
  const [status, setStatus] = useState<string | null>(null);
  const {
    clear: clearSaveFailure,
    clearField: clearSaveErrorField,
    error,
    errorField,
    setMessage: setFailureMessage,
  } = useContentSaveFailure();
  const [progress, setProgress] = useState<number | null>(null);
  const draft = drafts[activeSection];
  const binding = (loadout.data?.appearances ?? []).find(
    (candidate) => candidate.use === use,
  );

  const readyImages = useMemo(
    () =>
      (images.data ?? [])
        .filter((image) => image.state === "ready")
        .map((image) => ({ itemId: image.item_id, name: image.name })),
    [images.data],
  );

  useEffect(() => {
    if (!open || !loadout.data) return;
    const initial = (candidate: "profile" | "background"): AppearanceDraft => {
      const selected = (loadout.data.appearances ?? []).find(
        (row) => row.use === candidate,
      );
      return {
        itemId: selected?.item_id ?? "",
        config: normalizeConfig(selected?.presentation),
      };
    };
    setDrafts({
      profile_image: initial("profile"),
      background_image: initial("background"),
    });
    setPendingUpload(null);
    setStatus(null);
    clearSaveFailure();
    setProgress(null);
  }, [clearSaveFailure, loadout.data, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const selectedPreview = useAppearanceImagePreview(draft.itemId, use, {
    enabled: open && Boolean(draft.itemId),
  });
  const showsDefaultProfile = use === "profile" && !draft.itemId && !binding;
  const defaultProfile = useAnimaPresentationImage(
    showsDefaultProfile ? profileThumbnail : null,
  );
  const previewUrl = draft.itemId
    ? selectedPreview.url
    : showsDefaultProfile
      ? defaultProfile.url
      : null;
  const previewPending = draft.itemId
    ? selectedPreview.isPending
    : showsDefaultProfile
      ? defaultProfile.isPending
      : false;
  const busy =
    contentActions.createAppearanceImage.isPending ||
    mutations.planAppearance.isPending ||
    mutations.commitAppearance.isPending;

  const setDraft = (next: AppearanceDraft) => {
    setDrafts((current) => ({ ...current, [activeSection]: next }));
    clearSaveFailure();
  };

  const invalidatePresentation = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.animas.all(userId),
    });
  };

  const save = async () => {
    if (!loadout.data || busy) return;
    try {
      clearSaveFailure();
      const selected = (images.data ?? []).find(
        (image) => image.item_id === draft.itemId,
      );
      const source =
        selected?.source?.type === "catalog" && selected.source.source
          ? {
              type: "catalog" as const,
              catalog_item_id: selected.source.catalog_item_id,
              logical_key: selected.source.logical_key,
              source: selected.source.source,
            }
          : null;
      if (draft.itemId) {
        if (!source)
          throw new Error("The selected Local image is unavailable.");
        const intent = {
          operation: "set" as const,
          use,
          source,
          config: draft.config,
        };
        const plan = await mutations.planAppearance.mutateAsync({
          expected_revision: loadout.data.revision,
          intent,
        });
        await mutations.commitAppearance.mutateAsync({
          expected_revision: loadout.data.revision,
          intent,
          plan_digest: plan.plan_digest,
          idempotency_key: crypto.randomUUID(),
        });
      } else if (binding) {
        const intent = { operation: "remove" as const, use, config: {} };
        const plan = await mutations.planAppearance.mutateAsync({
          expected_revision: loadout.data.revision,
          intent,
        });
        await mutations.commitAppearance.mutateAsync({
          expected_revision: loadout.data.revision,
          intent,
          plan_digest: plan.plan_digest,
          idempotency_key: crypto.randomUUID(),
        });
      }
      await invalidatePresentation();
      toast.success(`${SECTION_LABELS[activeSection]} image updated.`);
      onOpenChange(false);
    } catch (caught) {
      setFailureMessage(
        caught instanceof Error
          ? caught.message
          : "The image could not be updated.",
      );
    }
  };

  const upload = async (pending: PendingUpload) => {
    const { file, operationId } = pending;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setFailureMessage("Choose a PNG, JPEG, or WebP image.", "files");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setFailureMessage("Choose an image smaller than 25 MiB.", "files");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPendingUpload(pending);
    clearSaveFailure();
    setProgress(0);
    try {
      const created = await contentActions.createAppearanceImage.mutateAsync({
        name: imageName(file.name),
        file,
        uses: ["profile", "background"],
        operationId,
        signal: controller.signal,
        onProgress: (next) => {
          setProgress(next.percent);
          setStatus(
            next.stage === "uploading"
              ? `Saving${next.percent === null ? "" : ` ${next.percent}%`}…`
              : "Preparing Local image…",
          );
        },
      });
      setDraft({ itemId: created.itemId, config: DEFAULT_CONFIG });
      setPendingUpload(null);
      setProgress(null);
      setStatus("Image is ready. Adjust the crop, then save it to this Anima.");
      toast.success("Local Appearance Image created.");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError")
        return;
      setProgress(null);
      setFailureMessage(
        getContentUploadErrorPresentation(
          caught,
          "The image could not be saved.",
        ).message,
        caught instanceof ContentSaveApiError ? caught.field : null,
      );
      setStatus(null);
    } finally {
      abortRef.current = null;
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !busy && onOpenChange(false)}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[min(92dvh,52rem)] flex-col overflow-hidden sm:max-w-2xl"
      >
        <DialogHeader className="flex-row items-center justify-between gap-3">
          <DialogTitle>Appearance</DialogTitle>
          <ContentHealth />
        </DialogHeader>
        <div className="border-border/70 grid grid-cols-2 rounded-xl border p-1">
          {(["profile_image", "background_image"] as const).map((candidate) => (
            <Button
              key={candidate}
              type="button"
              variant={candidate === activeSection ? "secondary" : "ghost"}
              onClick={() => onSectionChange(candidate)}
              disabled={busy}
            >
              {SECTION_LABELS[candidate]}
            </Button>
          ))}
        </div>
        <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
          <div
            className={cn(
              "bg-muted/20 border-border/60 rounded-2xl border p-3 sm:p-4",
              (errorField === "files" || errorField === "name") &&
                "border-destructive bg-destructive/5 ring-destructive/40 ring-1",
            )}
          >
            <RuntimeImageCropEditor
              key={`${activeSection}:${draft.itemId || "default"}`}
              src={previewUrl}
              alt={`${animaName} ${SECTION_LABELS[activeSection].toLocaleLowerCase()} preview`}
              presentation={draft.config}
              onPresentationChange={(config) => setDraft({ ...draft, config })}
              editable={!busy && Boolean(draft.itemId && previewUrl)}
              loading={previewPending}
              aspectRatio={activeSection === "profile_image" ? 1 : 16 / 9}
              circular={activeSection === "profile_image"}
              emptyLabel={
                activeSection === "profile_image"
                  ? "The Avatar portrait will be used"
                  : "No background image"
              }
              onUploadClick={() => fileInput.current?.click()}
              uploadDisabled={busy}
              uploadLabel={`Upload ${SECTION_LABELS[activeSection].toLocaleLowerCase()} image`}
            />
            <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
              <div className="border-border/70 flex rounded-lg border p-1">
                {(["cover", "contain"] as const).map((fit) => (
                  <Button
                    key={fit}
                    type="button"
                    size="sm"
                    variant={draft.config.fit === fit ? "secondary" : "ghost"}
                    disabled={busy || !draft.itemId}
                    onClick={() =>
                      setDraft({ ...draft, config: { ...draft.config, fit } })
                    }
                  >
                    {fit === "cover" ? "Fill" : "Fit"}
                  </Button>
                ))}
              </div>
              <label className="grid gap-2 text-sm font-medium">
                Zoom {draft.config.zoom.toFixed(1)}×
                <Slider
                  min={1}
                  max={4}
                  step={0.05}
                  value={[draft.config.zoom]}
                  disabled={busy || !draft.itemId}
                  onValueChange={([zoom]) =>
                    setDraft({
                      ...draft,
                      config: { ...draft.config, zoom: zoom ?? 1 },
                    })
                  }
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || !draft.itemId}
                onClick={() => setDraft({ ...draft, config: DEFAULT_CONFIG })}
              >
                <RotateCcw className="size-4" /> Reset
              </Button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <select
              className="border-input bg-background h-10 rounded-md border px-3 text-sm"
              value={draft.itemId}
              disabled={busy || images.isPending}
              onChange={(event) =>
                setDraft({ itemId: event.target.value, config: DEFAULT_CONFIG })
              }
              aria-label={`${SECTION_LABELS[activeSection]} image source`}
            >
              <option value="">
                {activeSection === "profile_image"
                  ? "Default Avatar portrait"
                  : "No image"}
              </option>
              {readyImages.map((image) => (
                <option key={image.itemId} value={image.itemId}>
                  {image.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              aria-invalid={errorField === "files" || errorField === "name"}
              className={cn(
                (errorField === "files" || errorField === "name") &&
                  "border-destructive text-destructive",
              )}
              asChild
            >
              <label>
                <Upload className="size-4" /> Upload image
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  disabled={busy}
                  aria-invalid={errorField === "files" || errorField === "name"}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      clearSaveErrorField("files");
                      clearSaveErrorField("name");
                      void upload({ file, operationId: crypto.randomUUID() });
                    }
                  }}
                />
              </label>
            </Button>
          </div>
          {progress !== null ? (
            <div
              role="progressbar"
              aria-label="Image save progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="bg-muted h-1.5 overflow-hidden rounded-full"
            >
              <div
                className="bg-primary h-full rounded-full transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : null}
          {status ? (
            <p className="text-muted-foreground text-sm">{status}</p>
          ) : null}
          {error ? (
            <div className="space-y-2" role="alert">
              <p className="text-destructive text-sm">{error}</p>
              {pendingUpload ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void upload(pendingUpload)}
                >
                  Retry save
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={busy || !binding}
            onClick={() => setDraft({ ...draft, itemId: "" })}
          >
            <Trash2 className="size-4" /> Remove
          </Button>
          <Button
            type="button"
            disabled={busy || !loadout.data}
            onClick={() => void save()}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}{" "}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
