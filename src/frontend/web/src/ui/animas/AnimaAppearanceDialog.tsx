"use client";

import { LoaderCircle, RotateCcw, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useFormatters } from "@animama/product-ui/i18n";

import type { PyRuntimeImageReference } from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { getContentUploadErrorPresentation } from "@/lib/content/contentUploads";
import { ContentSaveApiError } from "@/lib/content/contentSaveErrors";
import { apiErrorLine } from "@/lib/errors/apiError";
import { loadoutFailureText } from "@/lib/errors/loadoutErrors";
import { useContentSaveFailure } from "@/hooks/useContentSaveFailure";
import {
  mergePreferences,
  type SettingsPreferences,
} from "@/lib/settings/preferences";
import {
  STAGE_SCENES,
  appStageBackgroundUrl,
  stageSceneChoice,
  stageSceneToSave,
  type StageSceneChoice,
  type StageSceneId,
} from "@/lib/stage-background/stageBackground";
import { cn } from "@/lib/utils";
import { useAnimaLoadout } from "@/query/hooks/useAnimaLoadout";
import { useAnimaSettings } from "@/query/hooks/useAnimaSettings";
import { useAnimaPresentationImage } from "@/query/hooks/useAnimaPresentationImage";
import { useAppearanceImagePreview } from "@/query/hooks/useAppearanceImagePreview";
import { useAppearanceImages } from "@/query/hooks/useAppearanceImages";
import { queryKeys } from "@/query/keys";
import { useAnimaLoadoutMutations } from "@/query/mutations/useAnimaLoadoutMutations";
import { useAppearanceContentActions } from "@/query/mutations/useAppearanceContentActions";
import { useUpdateAnimaSettings } from "@/query/mutations/useUpdateAnimaSettings";
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
/**
 * `itemId` selects a Local image. With no image, a background draft shows the
 * app stage `scene` (or none).
 */
type AppearanceDraft = {
  itemId: string;
  config: AppearanceConfig;
  scene?: StageSceneChoice;
};
type PendingUpload = { file: File; operationId: string };

/** Section-specific wording; section IDs stay as the Loadout uses them. */
function sectionText(
  t: TFunction<"animas">,
  section: AnimaAppearanceSection,
  animaName: string,
) {
  return section === "background_image"
    ? {
        label: t("appearance.sections.background_image"),
        updated: t("appearance.updated.background_image"),
        previewAlt: t("appearance.previewAlt.background_image", {
          name: animaName,
        }),
        empty: t("appearance.empty.background_image"),
        upload: t("appearance.uploadLabel.background_image"),
        source: t("appearance.sourceLabel.background_image"),
        defaultOption: t("appearance.defaultOption.background_image"),
      }
    : {
        label: t("appearance.sections.profile_image"),
        updated: t("appearance.updated.profile_image"),
        previewAlt: t("appearance.previewAlt.profile_image", {
          name: animaName,
        }),
        empty: t("appearance.empty.profile_image"),
        upload: t("appearance.uploadLabel.profile_image"),
        source: t("appearance.sourceLabel.profile_image"),
        defaultOption: t("appearance.defaultOption.profile_image"),
      };
}
/** Select values for app scenes; never a Local item id. */
const SCENE_VALUE_PREFIX = "scene:";
const sceneValue = (scene: StageSceneChoice) => `${SCENE_VALUE_PREFIX}${scene}`;

function sceneLabel(t: TFunction<"animas">, scene: StageSceneId): string {
  switch (scene) {
    case "dreamy":
      return t("appearance.scenes.dreamy");
    case "bedroom":
      return t("appearance.scenes.bedroom");
    case "sakura":
      return t("appearance.scenes.sakura");
    case "seaside":
      return t("appearance.scenes.seaside");
    case "rooftop":
      return t("appearance.scenes.rooftop");
    case "cafe":
      return t("appearance.scenes.cafe");
    case "classroom":
      return t("appearance.scenes.classroom");
  }
}

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

/** The new image's name: its file name without the extension, else `fallback`. */
function imageName(filename: string, fallback: string) {
  const dot = filename.lastIndexOf(".");
  return (dot > 0 ? filename.slice(0, dot) : filename).trim() || fallback;
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
  onCloseAutoFocus,
}: {
  animaId: string;
  animaName: string;
  profileThumbnail: PyRuntimeImageReference | null;
  section: AnimaAppearanceSection | null;
  onSectionChange: (section: AnimaAppearanceSection) => void;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { t } = useTranslation("animas");
  const formatters = useFormatters();
  const open = section !== null;
  const activeSection = section ?? "profile_image";
  const text = sectionText(t, activeSection, animaName);
  const use = sectionUse(activeSection);
  const userId = useRuntimeCacheKey() ?? "__anon__";
  const queryClient = useQueryClient();
  const loadout = useAnimaLoadout(animaId);
  const images = useAppearanceImages();
  const mutations = useAnimaLoadoutMutations(animaId);
  const contentActions = useAppearanceContentActions();
  const animaSettings = useAnimaSettings(animaId, { enabled: open });
  const updateAnimaSettings = useUpdateAnimaSettings();
  const { resolvedTheme } = useTheme();
  const stageTheme = resolvedTheme === "dark" ? "dark" : "light";
  const storedPreferences =
    (animaSettings.data?.preferences as SettingsPreferences | undefined) ??
    null;
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
      // The scene stays unset until picked; the select shows the stored or
      // theme-default scene meanwhile.
      background_image: initial("background"),
    });
    setPendingUpload(null);
    setStatus(null);
    clearSaveFailure();
    setProgress(null);
  }, [clearSaveFailure, loadout.data, open, storedPreferences]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const selectedPreview = useAppearanceImagePreview(draft.itemId, use, {
    enabled: open && Boolean(draft.itemId),
  });
  const showsDefaultProfile = use === "profile" && !draft.itemId && !binding;
  const defaultProfile = useAnimaPresentationImage(
    showsDefaultProfile ? profileThumbnail : null,
  );
  const draftScene =
    draft.scene ?? stageSceneChoice(storedPreferences, stageTheme);
  const previewUrl = draft.itemId
    ? selectedPreview.url
    : showsDefaultProfile
      ? defaultProfile.url
      : use === "background" && draftScene !== "none"
        ? appStageBackgroundUrl(draftScene, stageTheme)
        : null;
  const previewPending = draft.itemId
    ? selectedPreview.isPending
    : showsDefaultProfile
      ? defaultProfile.isPending
      : false;
  const busy =
    contentActions.createAppearanceImage.isPending ||
    mutations.planAppearance.isPending ||
    mutations.commitAppearance.isPending ||
    updateAnimaSettings.isPending;

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
        if (!source) {
          setFailureMessage(t("appearance.localImageUnavailable"));
          return;
        }
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
      // A Local image keeps the stored scene for when it is removed.
      const sceneToSave = stageSceneToSave(draft.scene, storedPreferences);
      if (use === "background" && !draft.itemId && sceneToSave !== null) {
        await updateAnimaSettings.mutateAsync({
          animaId,
          body: {
            preferences: mergePreferences(storedPreferences ?? {}, {
              presentation: { stage_background: sceneToSave },
            }),
          },
        });
      }
      await invalidatePresentation();
      toast.success(text.updated);
      onOpenChange(false);
    } catch (caught) {
      setFailureMessage(
        apiErrorLine(loadoutFailureText(caught, t("appearance.saveFailed"))),
      );
    }
  };

  const upload = async (pending: PendingUpload) => {
    const { file, operationId } = pending;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setFailureMessage(t("appearance.fileType"), "files");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setFailureMessage(t("appearance.fileSize"), "files");
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
        name: imageName(file.name, t("appearance.defaultImageName")),
        file,
        uses: ["profile", "background"],
        operationId,
        signal: controller.signal,
        onProgress: (next) => {
          setProgress(next.percent);
          setStatus(
            next.stage === "uploading"
              ? next.percent === null
                ? t("appearance.saving")
                : t("appearance.savingProgress", {
                    percent: formatters.number(next.percent / 100, {
                      style: "percent",
                    }),
                  })
              : t("appearance.preparing"),
          );
        },
      });
      setDraft({ itemId: created.itemId, config: DEFAULT_CONFIG });
      setPendingUpload(null);
      setProgress(null);
      setStatus(t("appearance.ready"));
      toast.success(t("appearance.created"));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError")
        return;
      setProgress(null);
      setFailureMessage(
        getContentUploadErrorPresentation(caught, t("appearance.uploadFailed"))
          .message,
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
        onCloseAutoFocus={onCloseAutoFocus}
        aria-describedby={undefined}
        className="flex max-h-[min(92dvh,52rem)] flex-col overflow-hidden sm:max-w-2xl"
      >
        <DialogHeader className="flex-row items-center justify-between gap-3 pr-8">
          <DialogTitle>{t("appearance.title")}</DialogTitle>
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
              {sectionText(t, candidate, animaName).label}
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
              alt={text.previewAlt}
              presentation={draft.config}
              onPresentationChange={(config) => setDraft({ ...draft, config })}
              editable={!busy && Boolean(draft.itemId && previewUrl)}
              loading={previewPending}
              aspectRatio={activeSection === "profile_image" ? 1 : 16 / 9}
              circular={activeSection === "profile_image"}
              emptyLabel={text.empty}
              onUploadClick={() => fileInput.current?.click()}
              uploadDisabled={busy}
              uploadLabel={text.upload}
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
                    {fit === "cover"
                      ? t("appearance.fit.cover")
                      : t("appearance.fit.contain")}
                  </Button>
                ))}
              </div>
              <label className="grid gap-2 text-sm font-medium">
                {t("appearance.zoom", {
                  zoom: formatters.number(draft.config.zoom, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  }),
                })}
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
                <RotateCcw className="size-4" /> {t("actions.reset")}
              </Button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <select
              className="border-input bg-background h-10 rounded-md border px-3 text-sm"
              value={
                draft.itemId ||
                (activeSection === "background_image"
                  ? sceneValue(draftScene)
                  : "")
              }
              disabled={busy || images.isPending || animaSettings.isPending}
              onChange={(event) => {
                const value = event.target.value;
                setDraft(
                  value.startsWith(SCENE_VALUE_PREFIX)
                    ? {
                        ...draft,
                        itemId: "",
                        config: DEFAULT_CONFIG,
                        scene: value.slice(
                          SCENE_VALUE_PREFIX.length,
                        ) as StageSceneChoice,
                      }
                    : { ...draft, itemId: value, config: DEFAULT_CONFIG },
                );
              }}
              aria-label={text.source}
            >
              {activeSection === "profile_image" ? (
                <>
                  <option value="">{text.defaultOption}</option>
                  {readyImages.map((image) => (
                    <option key={image.itemId} value={image.itemId}>
                      {image.name}
                    </option>
                  ))}
                </>
              ) : (
                <>
                  <optgroup label={t("appearance.sceneGroups.app")}>
                    {STAGE_SCENES.map((scene) => (
                      <option key={scene} value={sceneValue(scene)}>
                        {sceneLabel(t, scene)}
                      </option>
                    ))}
                    <option value={sceneValue("none")}>
                      {t("appearance.scenes.none")}
                    </option>
                  </optgroup>
                  {readyImages.length ? (
                    <optgroup label={t("appearance.sceneGroups.local")}>
                      {readyImages.map((image) => (
                        <option key={image.itemId} value={image.itemId}>
                          {image.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </>
              )}
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
                <Upload className="size-4" /> {t("appearance.upload")}
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
              aria-label={t("appearance.progress")}
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
                  {t("appearance.retrySave")}
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
            <Trash2 className="size-4" /> {t("actions.remove")}
          </Button>
          <Button
            type="button"
            disabled={busy || !loadout.data}
            onClick={() => void save()}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}{" "}
            {t("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
