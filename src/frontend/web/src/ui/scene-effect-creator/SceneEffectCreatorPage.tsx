"use client";

import { SoundUploadButton } from "@/ui/sound-upload/SoundUploadButton";

import { ContentEditorHydration } from "@/lib/content/contentEditorSource";

import { useBlocker, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircle2Icon,
  Code2Icon,
  FileImageIcon,
  FolderOpenIcon,
  GripVerticalIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { previewCatalogItem } from "@/lib/content/catalogApi";
import type {
  PyContentDependency,
  PyContentPreview,
  PyExactContentSource,
} from "@/lib/content/catalogTypes";
import { Avatar } from "@/lib/avatar";
import { fetchContentPreviewFile } from "@/lib/content/contentPreview";
import { preflightContentFile, sha256File } from "@/lib/content/contentUploads";
import { findLogicalResourceFile } from "@/lib/content/typedLogicalResources";
import {
  applySceneEffectTemplate,
  buildSceneEffectEditorExport,
  canonicalSceneEffectImageName,
  createDefaultSceneEffectDocument,
  clearSceneEffectRecovery,
  createSceneEffectDocumentFromDefinition,
  parseSceneEffectEditorExport,
  SCENE_EFFECT_TEMPLATE_OPTIONS,
  sceneEffectDocumentFingerprint,
  sceneEffectEditorReducer,
  sceneEffectImageMetadata,
  sceneEffectRuntimeEntry,
  SCENE_EFFECT_IMAGE_TYPES,
  uniqueSceneEffectImageName,
  validateSceneEffectDocument,
  type SceneEffectEditorDocument,
  type SceneEffectEditorImage,
  type SceneEffectEditorImageResource,
  type SceneEffectEditorMarqueeItem,
  type SceneEffectEditorSound,
  type SceneEffectTemplateId,
} from "@/lib/scene-vfx/editor";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { SCENE_BACKGROUND_EMOJI_LINE_ITEMS } from "@/lib/scene-vfx/assets";
import { buildSceneVFXRuntimeEntry } from "@/lib/scene-vfx/runtime-state";
import {
  SCENE_BACKGROUND_DIRECTIONS,
  SCENE_BACKGROUND_ITEM_ROTATION_MODES,
  SCENE_BACKGROUND_PATTERN_KINDS,
  type SceneBackgroundPatternKind,
  type SceneVFXRuntimeEntry,
} from "@/lib/scene-vfx/types";
import { cn } from "@/lib/utils";
import { useSceneEffect, useSoundEffects } from "@/query/hooks/useEffects";
import { AvatarPreviewSurface } from "@/ui/avatar-preview/AvatarPreviewSurface";
import { PlaybackObservationOutput } from "@/ui/avatar-preview/PlaybackObservationOutput";
import { useContentPreviewAudio } from "@/ui/content-preview/useContentPreviewAudio";
import {
  CreatorCanvasControls,
  CreatorEffectHandoffActions,
  CreatorField as Field,
  CreatorFloatingPanel as FloatingPanel,
  CreatorImportDialog,
  CreatorJsonDialog,
  CreatorNumberField as NumberField,
  CreatorPreviewBar,
  CreatorSaveNotice,
  CreatorToggleRow as ToggleRow,
  CreatorToolbar,
  CreatorWorkspaceShell,
} from "@/ui/content-creator";
import { ContentHealth } from "@/ui/content-health/ContentHealth";
import type { ContentCreatorModelSource } from "@/ui/content-creator/contentCreatorModelPreview";
import { useContentCreatorAvatar } from "@/ui/content-creator/useContentCreatorAvatar";
import { useContentCreatorModelPreview } from "@/ui/content-creator/useContentCreatorModelPreview";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";
import { Switch } from "@/ui/components/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import { Textarea } from "@/ui/components/textarea";
import {
  createSceneEffectObjectUrlLease,
  sceneEffectCreatorKeyboardAction,
  SCENE_EFFECT_PREVIEW_MOTION_CLASS,
  shouldBlockSceneEffectNavigation,
} from "./sceneEffectCreatorBehavior";
import { useSceneEffectSave } from "./useSceneEffectSave";
import { useSceneEffectHistory } from "./useSceneEffectHistory";

const MAX_SCENE_IMAGE_BYTES = 32 * 1024 * 1024;
type PreviewStatus = {
  state: "idle" | "loading" | "ready" | "error";
  message: string | null;
};

type BackgroundLayer = "marquee" | "pattern" | "solid";

/** Product Scene Effect creator backed by ordinary editable catalog files. */
export function SceneEffectCreatorPage({ itemId }: { itemId?: string }) {
  const navigate = useNavigate();
  const userId = useRuntimeOwnerId();
  const existingQuery = useSceneEffect(itemId ?? null);
  const {
    document,
    imageResources,
    history,
    dispatch,
    resetDocument,
    getSnapshot,
  } = useSceneEffectHistory();
  const [imageUrls, setImageUrls] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [selectedLayer, setSelectedLayer] =
    useState<BackgroundLayer>("marquee");
  const [selectedModel, setSelectedModel] =
    useState<ContentCreatorModelSource | null>(null);
  const [previewAvatar, setPreviewAvatar] = useState<Avatar | null>(null);
  const [avatarStatus, setAvatarStatus] = useState<PreviewStatus>({
    state: "idle",
    message: null,
  });
  const [playing, setPlaying] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [cameraProfile, setCameraProfile] = useState<"full-body" | "portrait">(
    "full-body",
  );
  const [previewRevision, setPreviewRevision] = useState(0);
  const [hydration, setHydration] = useState<PreviewStatus>({
    state: itemId ? "loading" : "ready",
    message: null,
  });
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [soundPreview, setSoundPreview] = useState<PyContentPreview | null>(
    null,
  );
  const hydratedItemRef = useRef(new ContentEditorHydration());
  const initialFingerprintRef = useRef(
    sceneSaveFingerprint(document, imageResources),
  );

  const modelPreview = useContentCreatorModelPreview({
    ownerKey: `scene-effect-creator:${itemId ?? "new"}`,
    selectedModel,
    onSelectModel: setSelectedModel,
  });
  const soundQuery = useSoundEffects({ limit: 100, sort: "name" });
  const soundOptions = useMemo(
    () => soundQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [soundQuery.data?.pages],
  );
  const soundAudio = useContentPreviewAudio(soundPreview);

  useEffect(() => {
    const lease = createSceneEffectObjectUrlLease(imageResources);
    setImageUrls(lease.urls);
    return lease.dispose;
  }, [imageResources]);

  useEffect(() => {
    if (!document.sound) {
      setSoundPreview(null);
      return;
    }
    let cancelled = false;
    if (document.sound.source.type !== "catalog") {
      setSoundPreview(null);
      return;
    }
    void previewCatalogItem(
      document.sound.source.catalog_item_id,
      undefined,
      "sound_effect",
    )
      .then((preview) => {
        if (!cancelled) setSoundPreview(preview);
      })
      .catch(() => {
        if (!cancelled) setSoundPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [document.sound]);

  const validation = useMemo(
    () => validateSceneEffectDocument(document, imageResources),
    [document, imageResources],
  );
  const hasBlockingIssues = validation.some(
    (issue) => issue.severity === "error",
  );
  const onRestore = useCallback(
    (
      recoveredDocument: SceneEffectEditorDocument,
      recoveredImages: SceneEffectEditorImageResource[],
    ) => {
      resetDocument(recoveredDocument, recoveredImages);
      setHydration({ state: "ready", message: "Recovered local draft" });
      setPreviewRevision((value) => value + 1);
    },
    [resetDocument],
  );
  const onSaved = useCallback(
    (savedDocument: SceneEffectEditorDocument, savedItemId: string) => {
      dispatch({ type: "patch", patch: { name: savedDocument.name } });
      hydratedItemRef.current.preserve(savedItemId);
      initialFingerprintRef.current = sceneSaveFingerprint(
        savedDocument,
        imageResources,
      );
    },
    [dispatch, imageResources],
  );
  const contentSave = useSceneEffectSave({
    itemId,
    document,
    imageResources,
    initialized: hydration.state === "ready",
    ready: !hasBlockingIssues && !imageBusy && hydration.state === "ready",
    onRestore,
    onSaved,
  });
  useEffect(() => {
    if (
      contentSave.errorField === "files" &&
      document.kind === "background_layers"
    )
      setSelectedLayer("marquee");
  }, [contentSave.errorField, document.kind]);
  const currentFingerprint = sceneSaveFingerprint(document, imageResources);
  const isDirty = currentFingerprint !== initialFingerprintRef.current;
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      shouldBlockSceneEffectNavigation({
        dirty: isDirty,
        busy: contentSave.isBusy,
        currentPath: current.pathname,
        nextPath: next.pathname,
      }),
    enableBeforeUnload: () => isDirty || contentSave.isBusy,
    withResolver: true,
  });

  useEffect(() => {
    if (
      !itemId ||
      !contentSave.recoveryReady ||
      contentSave.recovered ||
      !existingQuery.data
    )
      return;
    const load = hydratedItemRef.current.begin(itemId);
    if (!load) return;
    const item = existingQuery.data;
    if (item.state !== "ready" || (item.origin === "owned" && !item.editable)) {
      setHydration({
        state: "error",
        message: "This Scene Effect is unavailable.",
      });
      return;
    }
    const controller = new AbortController();
    setHydration({ state: "loading", message: "Loading saved content…" });
    void hydrateSceneEffect({
      itemId: item.item_id,
      name: item.name,
      description: item.description ?? "",
      signal: controller.signal,
    })
      .then(({ document: loadedDocument, images }) => {
        if (controller.signal.aborted) return;
        load.complete();
        resetDocument(loadedDocument, images);
        initialFingerprintRef.current =
          item.origin === "builtin"
            ? "__included_copy__"
            : sceneSaveFingerprint(loadedDocument, images);
        setHydration({ state: "ready", message: null });
        setPreviewRevision((value) => value + 1);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setHydration({
          state: "error",
          message:
            error instanceof Error
              ? error.message
              : "The Scene Effect could not be opened.",
        });
      });
    return () => {
      controller.abort();
      load.cancel();
    };
  }, [
    contentSave.recovered,
    contentSave.recoveryReady,
    existingQuery.data,
    itemId,
    resetDocument,
  ]);

  const restartPreview = useCallback(() => {
    setPlaying(true);
    setPreviewRevision((value) => value + 1);
  }, []);
  const restartPreviewWithSound = useCallback(() => {
    restartPreview();
    soundAudio.stop();
    void soundAudio.play();
  }, [restartPreview, soundAudio]);
  const setPreviewPlaying = useCallback(
    (next: boolean) => {
      setPlaying(next);
      soundAudio.stop();
      if (next) void soundAudio.play();
    },
    [soundAudio],
  );
  const { canSave, save } = contentSave;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const action = sceneEffectCreatorKeyboardAction({
        key: event.key,
        code: event.code,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        editing:
          target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          Boolean(target?.isContentEditable),
      });
      if (action === "save") {
        event.preventDefault();
        if (canSave) void save();
      } else if (action === "toggle-preview") {
        event.preventDefault();
        setPreviewPlaying(!playing);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canSave, playing, save, setPreviewPlaying]);

  const onItemsChange = useCallback(
    (items: SceneEffectEditorMarqueeItem[]) => {
      const referenced = new Set(
        items.flatMap((item) =>
          item.kind === "image" ? [item.image.logicalName] : [],
        ),
      );
      dispatch(
        { type: "set-marquee-items", items },
        getSnapshot().imageResources.filter((resource) =>
          referenced.has(resource.logicalName),
        ),
      );
      restartPreview();
    },
    [dispatch, getSnapshot, restartPreview],
  );

  const choosePrivateImage = useCallback(
    async (source: File) => {
      setImageError(null);
      if (!SCENE_EFFECT_IMAGE_TYPES.has(source.type)) {
        setImageError("Choose a PNG, JPEG, WebP, or static SVG image.");
        return;
      }
      if (source.size > MAX_SCENE_IMAGE_BYTES) {
        setImageError("Private Scene images must total 32 MiB or less.");
        return;
      }
      setImageBusy(true);
      try {
        const preflight = await preflightContentFile("image", source);
        if (preflight.error) throw new Error(preflight.error);
        const sha256 = await sha256File(source);
        const { document, imageResources } = getSnapshot();
        const baseLogicalName = canonicalSceneEffectImageName(source.name);
        const missing = document.background.marquee.items.find(
          (item) =>
            item.kind === "image" &&
            item.image.logicalName === baseLogicalName &&
            !imageResources.some(
              (resource) => resource.logicalName === baseLogicalName,
            ),
        );
        const logicalName = missing
          ? baseLogicalName
          : uniqueSceneEffectImageName(
              source.name,
              document.background.marquee.items.flatMap((item) =>
                item.kind === "image" ? [item.image.logicalName] : [],
              ),
            );
        const sourceExtension =
          source.name.match(/\.(png|jpe?g|webp|svg)$/i)?.[0] ?? ".webp";
        const uploadName = logicalName.replace(
          /\.webp$/i,
          sourceExtension.toLowerCase(),
        );
        const file = new File([source], uploadName, {
          type: source.type,
          lastModified: source.lastModified,
        });
        const image: SceneEffectEditorImage = {
          logicalName,
          originalName: source.name,
          contentType: source.type,
          sizeBytes: source.size,
          sha256,
        };
        const current = getSnapshot();
        const items = missing
          ? current.document.background.marquee.items.map((item) =>
              item.kind === "image" && item.image.logicalName === logicalName
                ? { ...item, image }
                : item,
            )
          : [
              ...current.document.background.marquee.items,
              {
                id: `private-${crypto.randomUUID().slice(0, 8)}`,
                kind: "image" as const,
                label: source.name.replace(/\.[^.]+$/, ""),
                image,
              },
            ];
        let nextDocument = sceneEffectEditorReducer(current.document, {
          type: "set-marquee-items",
          items,
        });
        if (!missing)
          nextDocument = sceneEffectEditorReducer(nextDocument, {
            type: "patch-marquee",
            patch: { enabled: true },
          });
        dispatch({ type: "replace", document: nextDocument }, [
          ...current.imageResources.filter(
            (resource) => resource.logicalName !== logicalName,
          ),
          { logicalName, file, sha256 },
        ]);
        restartPreview();
      } catch (error) {
        setImageError(
          error instanceof Error
            ? error.message
            : "The image could not be read.",
        );
      } finally {
        setImageBusy(false);
      }
    },
    [dispatch, getSnapshot, restartPreview],
  );

  const importDocument = useCallback(() => {
    try {
      const parsed = parseSceneEffectEditorExport(JSON.parse(importText));
      if (isDirty && !window.confirm("Replace the current unsaved document?"))
        return;
      dispatch({ type: "replace", document: parsed }, []);
      setImportError(null);
      setImportOpen(false);
      restartPreview();
      if (sceneEffectImageMetadata(parsed).length)
        toast.info(
          "Reselect the imported document's private images before saving.",
        );
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : "The JSON could not be imported.",
      );
    }
  }, [dispatch, importText, isDirty, restartPreview]);

  const exportText = useMemo(
    () => JSON.stringify(buildSceneEffectEditorExport(document), null, 2),
    [document],
  );

  const startNewDocument = useCallback(async () => {
    if (contentSave.isBusy || imageBusy) return;
    if (
      isDirty &&
      !window.confirm(
        "Discard the current changes and start a new Scene Effect?",
      )
    )
      return;

    if (itemId) {
      if (userId) await clearSceneEffectRecovery(userId, "new");
      await navigate({
        to: "/a/scene-effects/new",
        replace: true,
        ignoreBlocker: true,
      });
      return;
    }

    const nextDocument = createDefaultSceneEffectDocument();
    const nextFingerprint = sceneSaveFingerprint(nextDocument, []);
    if (!(await contentSave.resetSession(nextFingerprint))) return;
    resetDocument(nextDocument, []);
    setSelectedLayer("marquee");
    setImageBusy(false);
    setImageError(null);
    setPlaying(true);
    setJsonOpen(false);
    setImportOpen(false);
    setImportText("");
    setImportError(null);
    setSoundPreview(null);
    initialFingerprintRef.current = nextFingerprint;
    setHydration({ state: "ready", message: null });
    setPreviewRevision((value) => value + 1);
  }, [
    contentSave,
    imageBusy,
    isDirty,
    itemId,
    navigate,
    resetDocument,
    userId,
  ]);
  const sceneVFX = useMemo<SceneVFXRuntimeEntry | null>(() => {
    if (!playing) return null;
    try {
      const entry = sceneEffectRuntimeEntry(document, imageUrls);
      entry.id = `scene-effect-editor-preview-${previewRevision}`;
      return buildSceneVFXRuntimeEntry(entry, previewRevision + 1);
    } catch {
      return null;
    }
  }, [document, imageUrls, playing, previewRevision]);

  if (hydration.state === "loading" && itemId)
    return (
      <CreatorLoading message={hydration.message ?? "Loading Scene Effect…"} />
    );

  return (
    <CreatorWorkspaceShell
      leftPanelWidth={330}
      rightPanelWidth={370}
      bottomChromeHeight={144}
      busy={contentSave.isBusy}
      canvas={
        <div
          className="relative size-full"
          data-playback-surface="creator-stage"
        >
          <AvatarPreviewSurface
            activeAvatar={previewAvatar}
            cameraProfile={cameraProfile}
            canvasTestId="scene-effect-creator-canvas"
            lifecycleOwner="creator"
            minDistance={0.6}
            maxDistance={6}
            sceneVFX={sceneVFX}
            sceneBackgroundScope="viewport"
            showSceneVFX
            overlay={
              showGuides ? (
                <ScenePreviewGuides document={document} />
              ) : undefined
            }
          >
            {modelPreview.modelEntry && modelPreview.modelEntryKey ? (
              <ScenePreviewActor
                entry={modelPreview.modelEntry}
                entryKey={modelPreview.modelEntryKey}
                onAvatarChange={setPreviewAvatar}
                onStatusChange={setAvatarStatus}
              />
            ) : null}
          </AvatarPreviewSurface>
          <PlaybackObservationOutput
            active
            avatar={previewAvatar}
            sceneVFX={sceneVFX}
            status={
              hydration.state === "error" || avatarStatus.state === "error"
                ? "error"
                : hydration.state === "loading" ||
                    avatarStatus.state === "loading" ||
                    modelPreview.isAnimaPending ||
                    modelPreview.isRuntimePending
                  ? "loading"
                  : !previewAvatar
                    ? "unavailable"
                    : sceneVFX
                      ? "playing"
                      : "stopped"
            }
            surface="creator-stage"
            target={{
              kind: "scene_vfx",
              runtimeId: document.name.trim() || "new-scene-effect",
            }}
          />
        </div>
      }
      toolbar={
        <CreatorToolbar
          contentHealth={<ContentHealth compact />}
          history={history}
          historyDisabled={
            contentSave.isBusy ||
            imageBusy ||
            hydration.state !== "ready" ||
            !contentSave.recoveryReady
          }
          typeLabel="Scene FX"
          contentType="scene_effect"
          typeIcon={<SparklesIcon />}
          documentName={document.name}
          documentNameInvalid={contentSave.errorField === "name"}
          documentNameDisabled={contentSave.isBusy}
          onDocumentNameChange={(name) => {
            contentSave.clearSaveErrorField("name");
            dispatch({ type: "patch", patch: { name } });
          }}
          status={
            contentSave.error
              ? {
                  label: "Save failed",
                  tone: "error",
                  tooltip: contentSave.error,
                }
              : {
                  label: isDirty ? "Unsaved" : "Saved",
                  tone: isDirty ? "dirty" : "saved",
                }
          }
          newDisabled={contentSave.isBusy || imageBusy}
          importDisabled={contentSave.isBusy || imageBusy}
          libraryDisabled={contentSave.isBusy || imageBusy}
          onNew={() => void startNewDocument()}
          onImport={() => {
            setImportText(exportText);
            setImportOpen(true);
          }}
          onJson={() => setJsonOpen(true)}
          onSave={() => void contentSave.save()}
          saveDisabled={!contentSave.canSave}
          saveBusy={contentSave.isBusy}
          saveLabel={
            contentSave.stage === "uploading"
              ? `Uploading ${contentSave.uploadProgress}%`
              : contentSave.stage === "validating"
                ? "Validating"
                : "Save"
          }
          domainActions={
            <CreatorEffectHandoffActions
              itemId={
                existingQuery.data?.origin === "owned" &&
                existingQuery.data.source
                  ? existingQuery.data.item_id
                  : null
              }
              componentType="scene_effect"
            />
          }
        />
      }
      leftPanelLabel="Setup"
      rightPanelLabel="Inspector"
      leftPanel={
        <SceneSetupPanel
          document={document}
          selectedLayer={selectedLayer}
          soundOptions={soundOptions}
          soundPending={soundQuery.isPending}
          onSelectedLayer={setSelectedLayer}
          onDispatch={(action) => {
            dispatch(action);
            restartPreview();
          }}
        />
      }
      rightPanel={
        <SceneInspectorPanel
          document={document}
          selectedLayer={selectedLayer}
          validation={validation}
          avatarStatus={avatarStatus}
          imageBusy={imageBusy}
          imageError={imageError}
          imageUrls={imageUrls}
          saveErrorField={contentSave.errorField}
          onDispatch={(action) => {
            dispatch(action);
            restartPreview();
          }}
          onItemsChange={onItemsChange}
          onChooseImage={choosePrivateImage}
          onClearSaveErrorField={contentSave.clearSaveErrorField}
        />
      }
      canvasControls={
        <CreatorCanvasControls
          model={{
            label: "Model",
            value: selectedModel?.key ?? "",
            placeholder: "Avatar",
            options: modelPreview.modelOptions.map((source) => ({
              value: source.key,
              label: source.displayName,
            })),
            onValueChange: (key) => {
              const source = modelPreview.modelOptions.find(
                (item) => item.key === key,
              );
              if (source) modelPreview.selectModel(source);
            },
            triggerClassName: "w-[150px]",
          }}
          view={{
            label: "View",
            value: cameraProfile,
            options: [
              { value: "full-body", label: "Full scene" },
              { value: "portrait", label: "Portrait" },
            ],
            onValueChange: (value) =>
              setCameraProfile(value as typeof cameraProfile),
            triggerClassName: "w-[110px]",
          }}
          guides={showGuides}
          onGuidesChange={setShowGuides}
          onRestart={restartPreviewWithSound}
        />
      }
      previewBar={
        <CreatorPreviewBar
          title="Scene FX"
          subtitle={`${humanize(document.kind)} · ${document.durationMs === null ? "Sticky" : `${(document.durationMs / 1000).toFixed(1)}s`}`}
          playing={playing}
          onPlayingChange={setPreviewPlaying}
          onRestart={restartPreviewWithSound}
          progressClassName={SCENE_EFFECT_PREVIEW_MOTION_CLASS}
          duration={{
            value:
              document.durationMs === null ? null : document.durationMs / 1000,
            label: "Effect duration",
            indefiniteLabel: "Sticky · until cleared",
            min: 0.1,
            max: 30,
            step: 0.1,
            onValueChange: (seconds) =>
              dispatch({
                type: "patch",
                patch: { durationMs: Math.round(seconds * 1000) },
              }),
          }}
        />
      }
      overlays={
        <>
          {hydration.state === "error" ? (
            <InlineError
              message={hydration.message ?? "Unable to open effect."}
            />
          ) : null}
          {contentSave.error || contentSave.recoveryWarning ? (
            <CreatorSaveNotice
              className="absolute top-[calc(var(--creator-header-height)+0.5rem)] right-4 left-4 z-[60] sm:left-auto sm:max-w-md lg:top-auto lg:bottom-28"
              message={contentSave.error ?? contentSave.recoveryWarning}
              tone={contentSave.error ? "error" : "warning"}
              actions={
                contentSave.error ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void contentSave.discardRecovery()}
                  >
                    Discard preserved server draft
                  </Button>
                ) : null
              }
            />
          ) : null}
          <CreatorJsonDialog
            open={jsonOpen}
            onOpenChange={setJsonOpen}
            title="Portable Scene Effect JSON"
            description="The authoring document contains local logical image names and exact dependency sources, never Blob URLs or storage capabilities."
            actions={
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setJsonOpen(false);
                    setImportText(exportText);
                    setImportOpen(true);
                  }}
                >
                  <FolderOpenIcon /> Import
                </Button>
                <Button
                  onClick={() => {
                    void navigator.clipboard.writeText(exportText);
                    toast.success("JSON copied.");
                  }}
                >
                  <Code2Icon /> Copy JSON
                </Button>
              </>
            }
          >
            <Textarea
              className="max-h-[55vh] min-h-80 font-mono text-xs"
              readOnly
              value={exportText}
            />
          </CreatorJsonDialog>
          <CreatorImportDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            title="Import Scene Effect JSON"
            description="Paste an Animama Scene Effect editor document. Private image bytes must be reselected."
            text={importText}
            error={importError}
            onTextChange={setImportText}
            onImport={importDocument}
          />
          <LeaveDialog
            busy={contentSave.isBusy}
            open={blocker.status === "blocked"}
            onOpenChange={(open) => {
              if (!open && blocker.status === "blocked") blocker.reset?.();
            }}
            onStay={() => blocker.reset?.()}
            onLeave={() => blocker.proceed?.()}
          />
        </>
      }
    />
  );
}

function SceneSetupPanel({
  document,
  selectedLayer,
  soundOptions,
  soundPending,
  onSelectedLayer,
  onDispatch,
}: {
  document: SceneEffectEditorDocument;
  selectedLayer: BackgroundLayer;
  soundOptions: Array<{
    item_id: string;
    name: string;
    source: PyExactContentSource | null;
  }>;
  soundPending: boolean;
  onSelectedLayer: (layer: BackgroundLayer) => void;
  onDispatch: React.Dispatch<Parameters<typeof sceneEffectEditorReducer>[1]>;
}) {
  return (
    <FloatingPanel title="Scene Setup" bodyClassName="overflow-y-auto">
      <Tabs
        value={document.kind}
        onValueChange={(kind) =>
          onDispatch({
            type: "set-kind",
            kind: kind as SceneEffectEditorDocument["kind"],
          })
        }
      >
        <TabsList className="grid h-9 w-full grid-cols-2">
          <TabsTrigger
            value="background_layers"
            className="min-w-0 px-1 text-xs"
          >
            Background
          </TabsTrigger>
          <TabsTrigger value="focus_lines" className="min-w-0 px-1 text-xs">
            Focus Lines
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mt-3 space-y-3">
        <Field label="Starting template">
          <Select
            value=""
            onValueChange={(value) =>
              onDispatch({
                type: "replace",
                document: applySceneEffectTemplate(
                  document,
                  value as SceneEffectTemplateId,
                ),
              })
            }
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue placeholder="Custom" />
            </SelectTrigger>
            <SelectContent>
              {SCENE_EFFECT_TEMPLATE_OPTIONS.filter(
                (template) => template.kind === document.kind,
              ).map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {document.kind === "background_layers" ? (
          <div className="space-y-2">
            <Label className="text-xs">Layers</Label>
            <LayerCard
              selected={selectedLayer === "marquee"}
              title="Marquee"
              subtitle={`${document.background.marquee.items.length} items · ${humanize(document.background.marquee.direction)}`}
              enabled={document.background.marquee.enabled}
              onSelect={() => onSelectedLayer("marquee")}
              onEnabled={(enabled) =>
                onDispatch({ type: "patch-marquee", patch: { enabled } })
              }
            />
            <LayerCard
              selected={selectedLayer === "pattern"}
              title="Pattern"
              subtitle={`${humanize(document.background.pattern.pattern)} · ${document.background.pattern.size}px`}
              enabled={document.background.pattern.enabled}
              onSelect={() => onSelectedLayer("pattern")}
              onEnabled={(enabled) =>
                onDispatch({ type: "patch-pattern", patch: { enabled } })
              }
            />
            <LayerCard
              selected={selectedLayer === "solid"}
              title="Solid"
              subtitle={document.background.solid.color}
              enabled={document.background.solid.enabled}
              onSelect={() => onSelectedLayer("solid")}
              onEnabled={(enabled) =>
                onDispatch({ type: "patch-solid", patch: { enabled } })
              }
            />
          </div>
        ) : (
          <div className="border-border/70 bg-background/55 rounded-lg border p-3">
            <div className="text-xs font-medium">Focus Lines</div>
            <p className="text-muted-foreground text-xs">
              Emphasize the Avatar’s face or a selected area.
            </p>
          </div>
        )}

        <div className="border-border/70 space-y-3 border-t pt-3">
          <Label>Effect behavior</Label>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Duration (s)"
              value={
                document.durationMs === null ? 5 : document.durationMs / 1000
              }
              min={0.1}
              max={30}
              step={0.1}
              disabled={document.durationMs === null}
              onChange={(seconds) =>
                onDispatch({
                  type: "patch",
                  patch: { durationMs: Math.round(seconds * 1000) },
                })
              }
            />
            <ToggleRow
              label="Sticky"
              checked={document.durationMs === null}
              onChecked={(sticky) =>
                onDispatch({
                  type: "patch",
                  patch: { durationMs: sticky ? null : 5000 },
                })
              }
            />
          </div>
          <ToggleRow
            label="Cover UI overlays"
            description="Preview the effect over app chrome when supported."
            checked={document.coverUiOverlays}
            onChecked={(coverUiOverlays) =>
              onDispatch({ type: "patch", patch: { coverUiOverlays } })
            }
          />
          <ToggleRow
            label="Dismiss on input"
            checked={document.dismissOnInput}
            onChecked={(dismissOnInput) =>
              onDispatch({ type: "patch", patch: { dismissOnInput } })
            }
          />
          <Field label="Sound when applied">
            <SoundUploadButton />
            <Select
              value={soundSourceKey(document.sound?.source ?? null)}
              onValueChange={(value) => {
                if (value === "none") {
                  onDispatch({ type: "patch", patch: { sound: null } });
                  return;
                }
                const option = soundOptions.find(
                  (item) => soundSourceKey(item.source) === value,
                );
                if (!option?.source) return;
                onDispatch({
                  type: "patch",
                  patch: {
                    sound: {
                      alias: "on-apply",
                      label: option.name,
                      source: option.source,
                    },
                  },
                });
              }}
            >
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue
                  placeholder={soundPending ? "Loading sounds…" : "No sound"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No sound</SelectItem>
                {document.sound &&
                !soundOptions.some(
                  (item) =>
                    soundSourceKey(item.source) ===
                    soundSourceKey(document.sound?.source ?? null),
                ) ? (
                  <SelectItem value={soundSourceKey(document.sound.source)}>
                    {document.sound.label} · exact content
                  </SelectItem>
                ) : null}
                {soundOptions.flatMap((item) =>
                  item.source ? (
                    <SelectItem
                      key={item.item_id}
                      value={soundSourceKey(item.source)}
                    >
                      {item.name}
                    </SelectItem>
                  ) : (
                    []
                  ),
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Description">
            <Textarea
              className="min-h-16 text-xs"
              rows={2}
              value={document.description}
              maxLength={2000}
              onChange={(event) =>
                onDispatch({
                  type: "patch",
                  patch: { description: event.target.value },
                })
              }
            />
          </Field>
        </div>
      </div>
    </FloatingPanel>
  );
}

function LayerCard({
  selected,
  title,
  subtitle,
  enabled,
  onSelect,
  onEnabled,
}: {
  selected: boolean;
  title: string;
  subtitle: string;
  enabled: boolean;
  onSelect: () => void;
  onEnabled: (enabled: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "border-border/70 bg-background/55 flex items-center gap-2 rounded-lg border p-2",
        selected && "border-sky-300 bg-sky-50/75 dark:bg-sky-950/35",
      )}
    >
      <GripVerticalIcon className="text-muted-foreground size-4" />
      <button
        type="button"
        className="focus-visible:ring-ring min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2"
        aria-pressed={selected}
        onClick={onSelect}
      >
        <div className="text-sm font-medium">{title}</div>
        <div className="text-muted-foreground truncate text-xs">{subtitle}</div>
      </button>
      <Switch
        checked={enabled}
        onCheckedChange={onEnabled}
        aria-label={`${title} enabled`}
      />
    </div>
  );
}

function SceneInspectorPanel({
  document,
  selectedLayer,
  validation,
  avatarStatus,
  imageBusy,
  imageError,
  imageUrls,
  saveErrorField,
  onDispatch,
  onItemsChange,
  onChooseImage,
  onClearSaveErrorField,
}: {
  document: SceneEffectEditorDocument;
  selectedLayer: BackgroundLayer;
  validation: ReturnType<typeof validateSceneEffectDocument>;
  avatarStatus: PreviewStatus;
  imageBusy: boolean;
  imageError: string | null;
  imageUrls: ReadonlyMap<string, string>;
  saveErrorField: string | null;
  onDispatch: React.Dispatch<Parameters<typeof sceneEffectEditorReducer>[1]>;
  onItemsChange: (items: SceneEffectEditorMarqueeItem[]) => void;
  onChooseImage: (file: File) => void;
  onClearSaveErrorField: (field: string) => void;
}) {
  return (
    <FloatingPanel
      title="Inspector"
      summary={
        document.kind === "background_layers"
          ? `${humanize(selectedLayer)} layer`
          : "Focus Lines"
      }
      bodyClassName="overflow-y-auto"
    >
      {document.kind === "background_layers" ? (
        selectedLayer === "marquee" ? (
          <MarqueeInspector
            document={document}
            imageBusy={imageBusy}
            imageError={imageError}
            imageUrls={imageUrls}
            saveErrorField={saveErrorField}
            onDispatch={onDispatch}
            onItemsChange={onItemsChange}
            onChooseImage={onChooseImage}
            onClearSaveErrorField={onClearSaveErrorField}
          />
        ) : selectedLayer === "pattern" ? (
          <PatternInspector document={document} onDispatch={onDispatch} />
        ) : (
          <SolidInspector document={document} onDispatch={onDispatch} />
        )
      ) : (
        <FocusInspector document={document} onDispatch={onDispatch} />
      )}
      <details
        className="border-border/70 mt-3 border-t pt-3"
        open={
          validation.some((issue) => issue.severity === "error") || undefined
        }
      >
        <summary className="cursor-pointer text-xs font-medium">Checks</summary>
        <div className="mt-3 space-y-3">
          {validation.length ? (
            validation.map((issue, index) => (
              <StatusRow
                key={`${issue.field}:${index}`}
                good={issue.severity !== "error"}
                label={humanize(issue.field)}
                detail={issue.message}
              />
            ))
          ) : (
            <StatusRow
              good
              label="Ready to save"
              detail="Scene settings are ready."
            />
          )}
          <StatusRow
            good={avatarStatus.state === "ready"}
            label="Preview Avatar"
            detail={avatarStatus.message ?? humanize(avatarStatus.state)}
          />
        </div>
      </details>
    </FloatingPanel>
  );
}

function MarqueeInspector({
  document,
  imageBusy,
  imageError,
  imageUrls,
  saveErrorField,
  onDispatch,
  onItemsChange,
  onChooseImage,
  onClearSaveErrorField,
}: {
  document: SceneEffectEditorDocument;
  imageBusy: boolean;
  imageError: string | null;
  imageUrls: ReadonlyMap<string, string>;
  saveErrorField: string | null;
  onDispatch: React.Dispatch<Parameters<typeof sceneEffectEditorReducer>[1]>;
  onItemsChange: (items: SceneEffectEditorMarqueeItem[]) => void;
  onChooseImage: (file: File) => void;
  onClearSaveErrorField: (field: string) => void;
}) {
  const marquee = document.background.marquee;
  const [emojiId, setEmojiId] = useState(
    SCENE_BACKGROUND_EMOJI_LINE_ITEMS[0]?.id ?? "",
  );
  return (
    <Tabs defaultValue="content">
      <TabsList className="grid h-9 w-full grid-cols-3">
        <TabsTrigger value="content" className="min-w-0 px-1 text-xs">
          Content
        </TabsTrigger>
        <TabsTrigger value="motion" className="min-w-0 px-1 text-xs">
          Motion
        </TabsTrigger>
        <TabsTrigger value="appearance" className="min-w-0 px-1 text-xs">
          Appearance
        </TabsTrigger>
      </TabsList>
      <TabsContent value="content" className="mt-3 space-y-3">
        <Label>Items</Label>
        {marquee.items.length ? (
          <div className="space-y-2">
            {marquee.items.map((item, index) => (
              <MarqueeItemRow
                key={item.id}
                item={item}
                imageUrl={
                  item.kind === "image"
                    ? imageUrls.get(item.image.logicalName)
                    : undefined
                }
                first={index === 0}
                last={index === marquee.items.length - 1}
                onMove={(offset) =>
                  onItemsChange(moveItem(marquee.items, index, index + offset))
                }
                onRemove={() =>
                  onItemsChange(
                    marquee.items.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Add an emoji or private image.
          </p>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Select value={emojiId} onValueChange={setEmojiId}>
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue placeholder="Choose emoji" />
            </SelectTrigger>
            <SelectContent>
              {SCENE_BACKGROUND_EMOJI_LINE_ITEMS.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.emoji} {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const selected = SCENE_BACKGROUND_EMOJI_LINE_ITEMS.find(
                (item) => item.id === emojiId,
              );
              if (!selected) return;
              onItemsChange([
                ...marquee.items,
                {
                  id: `${selected.id}-${crypto.randomUUID().slice(0, 6)}`,
                  kind: "emoji",
                  label: selected.label,
                  emoji: selected.emoji,
                  provider: "twemoji",
                },
              ]);
            }}
          >
            Add emoji
          </Button>
        </div>
        <label
          className={cn(
            "border-border/70 bg-background/55 hover:bg-accent/50 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed p-3 text-sm transition",
            saveErrorField === "files" &&
              "border-destructive bg-destructive/5 text-destructive ring-destructive/40 ring-1",
          )}
        >
          {imageBusy ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <ImagePlusIcon className="size-4" />
          )}
          Add private image
          <input
            className="sr-only"
            type="file"
            accept={[...SCENE_EFFECT_IMAGE_TYPES].join(",")}
            aria-invalid={saveErrorField === "files"}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                onClearSaveErrorField("files");
                void onChooseImage(file);
              }
              event.currentTarget.value = "";
            }}
          />
        </label>
        {imageError ? (
          <p className="text-destructive text-xs">{imageError}</p>
        ) : null}
      </TabsContent>
      <TabsContent value="motion" className="mt-3 space-y-3">
        <Field label="Direction">
          <Select
            value={marquee.direction}
            onValueChange={(direction) =>
              onDispatch({
                type: "patch-marquee",
                patch: { direction: direction as typeof marquee.direction },
              })
            }
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCENE_BACKGROUND_DIRECTIONS.map((direction) => (
                <SelectItem key={direction} value={direction}>
                  {humanize(direction)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <NumberField
          label="Speed (px/s)"
          value={marquee.speedPxPerSec}
          min={0}
          max={2000}
          step={10}
          onChange={(speedPxPerSec) =>
            onDispatch({ type: "patch-marquee", patch: { speedPxPerSec } })
          }
        />
        <Field label="Rotation">
          <Select
            value={marquee.itemRotationMode}
            onValueChange={(itemRotationMode) =>
              onDispatch({
                type: "patch-marquee",
                patch: {
                  itemRotationMode:
                    itemRotationMode as typeof marquee.itemRotationMode,
                },
              })
            }
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCENE_BACKGROUND_ITEM_ROTATION_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {humanize(mode)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <NumberField
          label="Rotation offset (deg)"
          value={marquee.itemRotationOffsetDeg}
          min={-360}
          max={360}
          step={1}
          onChange={(itemRotationOffsetDeg) =>
            onDispatch({
              type: "patch-marquee",
              patch: { itemRotationOffsetDeg },
            })
          }
        />
      </TabsContent>
      <TabsContent value="appearance" className="mt-3 grid grid-cols-2 gap-3">
        <NumberField
          label="Item size"
          value={marquee.itemSize}
          min={1}
          max={1024}
          step={1}
          onChange={(itemSize) =>
            onDispatch({ type: "patch-marquee", patch: { itemSize } })
          }
        />
        <NumberField
          label="Gap"
          value={marquee.gap}
          min={0}
          max={2048}
          step={1}
          onChange={(gap) =>
            onDispatch({ type: "patch-marquee", patch: { gap } })
          }
        />
        <NumberField
          label="Row gap"
          value={marquee.rowGap}
          min={0}
          max={2048}
          step={1}
          onChange={(rowGap) =>
            onDispatch({ type: "patch-marquee", patch: { rowGap } })
          }
        />
        <NumberField
          label="Opacity"
          value={marquee.opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(opacity) =>
            onDispatch({ type: "patch-marquee", patch: { opacity } })
          }
        />
      </TabsContent>
    </Tabs>
  );
}

function MarqueeItemRow({
  item,
  imageUrl,
  first,
  last,
  onMove,
  onRemove,
}: {
  item: SceneEffectEditorMarqueeItem;
  imageUrl?: string;
  first: boolean;
  last: boolean;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border-border/70 bg-background/55 flex items-center gap-2 rounded-lg border p-2">
      <GripVerticalIcon className="text-muted-foreground size-4" />
      <div className="bg-muted flex size-8 items-center justify-center overflow-hidden rounded-md">
        {item.kind === "emoji" ? (
          <span>{item.emoji}</span>
        ) : imageUrl ? (
          <img src={imageUrl} alt="" className="size-full object-contain" />
        ) : (
          <FileImageIcon className="text-muted-foreground size-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{item.label}</div>
        <div className="text-muted-foreground truncate text-[11px]">
          {item.kind === "image" ? item.image.logicalName : "Twemoji"}
        </div>
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={first}
        aria-label={`Move ${item.label} up`}
        onClick={() => onMove(-1)}
      >
        <ArrowUpIcon />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={last}
        aria-label={`Move ${item.label} down`}
        onClick={() => onMove(1)}
      >
        <ArrowDownIcon />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`Remove ${item.label}`}
        onClick={onRemove}
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

function PatternInspector({ document, onDispatch }: InspectorFieldsProps) {
  const pattern = document.background.pattern;
  return (
    <div className="space-y-3">
      <ToggleRow
        label="Pattern enabled"
        checked={pattern.enabled}
        onChecked={(enabled) =>
          onDispatch({ type: "patch-pattern", patch: { enabled } })
        }
      />
      <Field label="Pattern kind">
        <Select
          value={pattern.pattern}
          onValueChange={(value) =>
            onDispatch({
              type: "patch-pattern",
              patch: { pattern: value as SceneBackgroundPatternKind },
            })
          }
        >
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCENE_BACKGROUND_PATTERN_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {humanize(kind)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <ColorField
        label="Color"
        value={pattern.color}
        onChange={(color) =>
          onDispatch({ type: "patch-pattern", patch: { color } })
        }
      />
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Size"
          value={pattern.size}
          min={1}
          max={512}
          step={1}
          onChange={(size) =>
            onDispatch({ type: "patch-pattern", patch: { size } })
          }
        />
        <NumberField
          label="Spacing"
          value={pattern.spacing}
          min={0}
          max={1024}
          step={1}
          onChange={(spacing) =>
            onDispatch({ type: "patch-pattern", patch: { spacing } })
          }
        />
        <NumberField
          label="Opacity"
          value={pattern.opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(opacity) =>
            onDispatch({ type: "patch-pattern", patch: { opacity } })
          }
        />
      </div>
    </div>
  );
}

function SolidInspector({ document, onDispatch }: InspectorFieldsProps) {
  return (
    <div className="space-y-3">
      <ToggleRow
        label="Solid enabled"
        checked={document.background.solid.enabled}
        onChecked={(enabled) =>
          onDispatch({ type: "patch-solid", patch: { enabled } })
        }
      />
      <ColorField
        label="Solid color"
        value={document.background.solid.color}
        onChange={(color) =>
          onDispatch({ type: "patch-solid", patch: { color } })
        }
      />
    </div>
  );
}

function FocusInspector({ document, onDispatch }: InspectorFieldsProps) {
  const focus = document.focus;
  return (
    <Tabs defaultValue="target">
      <TabsList className="grid h-9 w-full grid-cols-4">
        <TabsTrigger value="target" className="min-w-0 px-1 text-xs">
          Target
        </TabsTrigger>
        <TabsTrigger value="geometry" className="min-w-0 px-1 text-xs">
          Lines
        </TabsTrigger>
        <TabsTrigger value="animation" className="min-w-0 px-1 text-xs">
          Motion
        </TabsTrigger>
        <TabsTrigger value="appearance" className="min-w-0 px-1 text-xs">
          Style
        </TabsTrigger>
      </TabsList>
      <TabsContent value="target" className="mt-3 space-y-3">
        <Field label="Render placement">
          <Select
            value={focus.renderPlacement}
            onValueChange={(renderPlacement) =>
              onDispatch({
                type: "patch-focus",
                patch: {
                  renderPlacement:
                    renderPlacement as typeof focus.renderPlacement,
                },
              })
            }
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="behind_avatar">Behind Avatar</SelectItem>
              <SelectItem value="front_of_avatar">Front of Avatar</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Target">
          <Select
            value={focus.target.kind}
            onValueChange={(kind) =>
              onDispatch({
                type: "set-focus-target",
                target:
                  kind === "manual_box"
                    ? {
                        kind: "manual_box",
                        rect: { x: 0.33, y: 0.18, width: 0.34, height: 0.42 },
                      }
                    : { kind: "avatar_face", paddingXPx: 48, paddingYPx: 96 },
              })
            }
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="avatar_face">Avatar face</SelectItem>
              <SelectItem value="manual_box">Manual box</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {focus.target.kind === "avatar_face" ? (
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Padding X"
              value={focus.target.paddingXPx}
              min={0}
              max={2048}
              step={1}
              onChange={(paddingXPx) =>
                onDispatch({
                  type: "set-focus-target",
                  target: {
                    kind: "avatar_face",
                    paddingXPx,
                    paddingYPx:
                      focus.target.kind === "avatar_face"
                        ? focus.target.paddingYPx
                        : 96,
                  },
                })
              }
            />
            <NumberField
              label="Padding Y"
              value={focus.target.paddingYPx}
              min={0}
              max={2048}
              step={1}
              onChange={(paddingYPx) =>
                onDispatch({
                  type: "set-focus-target",
                  target: {
                    kind: "avatar_face",
                    paddingXPx:
                      focus.target.kind === "avatar_face"
                        ? focus.target.paddingXPx
                        : 48,
                    paddingYPx,
                  },
                })
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {(["x", "y", "width", "height"] as const).map((field) => (
              <NumberField
                key={field}
                label={humanize(field)}
                value={
                  focus.target.kind === "manual_box"
                    ? focus.target.rect[field]
                    : 0
                }
                min={0}
                max={1}
                step={0.01}
                onChange={(value) =>
                  focus.target.kind === "manual_box" &&
                  onDispatch({
                    type: "set-focus-target",
                    target: {
                      ...focus.target,
                      rect: { ...focus.target.rect, [field]: value },
                    },
                  })
                }
              />
            ))}
          </div>
        )}
      </TabsContent>
      <TabsContent value="geometry" className="mt-3 grid grid-cols-2 gap-3">
        <NumberField
          label="Line count"
          value={focus.lineCount}
          min={1}
          max={256}
          step={1}
          onChange={(lineCount) =>
            onDispatch({ type: "patch-focus", patch: { lineCount } })
          }
        />
        <NumberField
          label="Base thickness"
          value={focus.baseThicknessPx}
          min={0.1}
          max={128}
          step={0.1}
          onChange={(baseThicknessPx) =>
            onDispatch({ type: "patch-focus", patch: { baseThicknessPx } })
          }
        />
        <NumberField
          label="Thickness variation"
          value={focus.thicknessVariationPx}
          min={0}
          max={128}
          step={0.1}
          onChange={(thicknessVariationPx) =>
            onDispatch({ type: "patch-focus", patch: { thicknessVariationPx } })
          }
        />
        <NumberField
          label="Length variation"
          value={focus.lengthVariation}
          min={0}
          max={1}
          step={0.01}
          onChange={(lengthVariation) =>
            onDispatch({ type: "patch-focus", patch: { lengthVariation } })
          }
        />
        <NumberField
          label="Overscan"
          value={focus.overscanPx}
          min={0}
          max={4096}
          step={1}
          onChange={(overscanPx) =>
            onDispatch({ type: "patch-focus", patch: { overscanPx } })
          }
        />
        <NumberField
          label="Seed"
          value={focus.seed ?? 0}
          min={0}
          max={2147483647}
          step={1}
          onChange={(seed) =>
            onDispatch({ type: "patch-focus", patch: { seed } })
          }
        />
      </TabsContent>
      <TabsContent value="animation" className="mt-3 grid grid-cols-2 gap-3">
        {(
          [
            "minVisibleMs",
            "maxVisibleMs",
            "minHiddenMs",
            "maxHiddenMs",
          ] as const
        ).map((field) => (
          <NumberField
            key={field}
            label={humanize(field)}
            value={focus.animation[field]}
            min={0}
            max={10000}
            step={10}
            onChange={(value) =>
              onDispatch({
                type: "patch-focus-animation",
                patch: { [field]: value },
              })
            }
          />
        ))}
        <NumberField
          label="Opacity jitter"
          value={focus.animation.opacityJitter}
          min={0}
          max={1}
          step={0.01}
          onChange={(opacityJitter) =>
            onDispatch({
              type: "patch-focus-animation",
              patch: { opacityJitter },
            })
          }
        />
      </TabsContent>
      <TabsContent value="appearance" className="mt-3 space-y-3">
        <ColorField
          label="Line color"
          value={focus.color}
          onChange={(color) =>
            onDispatch({ type: "patch-focus", patch: { color } })
          }
        />
        <NumberField
          label="Opacity"
          value={focus.opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(opacity) =>
            onDispatch({ type: "patch-focus", patch: { opacity } })
          }
        />
      </TabsContent>
    </Tabs>
  );
}

type InspectorFieldsProps = {
  document: SceneEffectEditorDocument;
  onDispatch: React.Dispatch<Parameters<typeof sceneEffectEditorReducer>[1]>;
};

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-[44px_1fr] gap-2">
        <Input
          type="color"
          className="p-1"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          value={value}
          maxLength={7}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </Field>
  );
}

function StatusRow({
  good,
  label,
  detail,
}: {
  good: boolean;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex gap-2 text-xs">
      {good ? (
        <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      ) : (
        <AlertTriangleIcon className="text-destructive mt-0.5 size-4 shrink-0" />
      )}
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function ScenePreviewActor({
  entry,
  entryKey,
  onAvatarChange,
  onStatusChange,
}: {
  entry: Parameters<typeof useContentCreatorAvatar>[0]["entry"];
  entryKey: string;
  onAvatarChange: (avatar: Avatar | null) => void;
  onStatusChange: (status: PreviewStatus) => void;
}) {
  const { sceneObject } = useContentCreatorAvatar({
    entry,
    entryKey,
    onAvatarChange,
    onStatusChange,
  });
  return sceneObject ? <primitive object={sceneObject} dispose={null} /> : null;
}

function ScenePreviewGuides({
  document,
}: {
  document: SceneEffectEditorDocument;
}) {
  if (
    document.kind === "focus_lines" &&
    document.focus.target.kind === "manual_box"
  ) {
    const rect = document.focus.target.rect;
    return (
      <div
        className="pointer-events-none absolute inset-0 z-30"
        aria-hidden="true"
      >
        <div
          className="absolute border border-dashed border-sky-400 bg-sky-200/10"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
          }}
        />
      </div>
    );
  }
  return (
    <div
      className="pointer-events-none absolute inset-0 z-30"
      aria-hidden="true"
    >
      <div className="absolute top-1/2 right-[25%] left-[25%] border-t border-dashed border-sky-300/55" />
      <div className="absolute top-[12%] bottom-[12%] left-1/2 border-l border-dashed border-sky-300/55" />
    </div>
  );
}

function LeaveDialog({
  busy,
  open,
  onOpenChange,
  onStay,
  onLeave,
}: {
  busy: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStay: () => void;
  onLeave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {busy
              ? "Leave while content is being saved?"
              : "Discard authoring changes?"}
          </DialogTitle>
          <DialogDescription>
            {busy
              ? "This Scene Effect is still being saved. Local recovery remains available when you return."
              : "This Scene Effect has local authoring changes. Leaving will discard them from the active workspace. Local recovery remains available when you return."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onStay}>
            Stay
          </Button>
          <Button onClick={onLeave}>Discard and continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreatorLoading({ message }: { message: string }) {
  return (
    <div className="bg-background flex h-full items-center justify-center">
      <div className="text-muted-foreground flex items-center gap-2">
        <LoaderCircleIcon className="animate-spin" />
        {message}
      </div>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="bg-background text-destructive border-destructive/30 absolute top-[calc(var(--creator-header-height)+0.5rem)] left-1/2 z-[60] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-2 text-sm">
      <AlertTriangleIcon className="size-4" />
      {message}
    </div>
  );
}

async function hydrateSceneEffect(args: {
  itemId: string;
  name: string;
  description: string;
  signal: AbortSignal;
}): Promise<{
  document: SceneEffectEditorDocument;
  images: SceneEffectEditorImageResource[];
}> {
  const preview = await previewCatalogItem(
    args.itemId,
    args.signal,
    "scene_effect",
  );
  const metadata = object(preview.metadata);
  const definition = metadata?.definition ?? object(metadata?.spec)?.definition;
  const logicalFiles = object(metadata?.logical_resource_files) ?? {};
  const imageMetadata = new Map<string, SceneEffectEditorImage>();
  const resources: SceneEffectEditorImageResource[] = [];
  for (const [logicalName, rawIdentity] of Object.entries(logicalFiles)) {
    const identity = object(rawIdentity);
    const file =
      preview.files.find((candidate) => candidate.filename === logicalName) ??
      findLogicalResourceFile(preview.files, identity ?? {});
    if (!file)
      throw new Error(`The content image ${logicalName} is unavailable.`);
    const response = await fetchContentPreviewFile(preview, file, {
      signal: args.signal,
    });
    if (!response.ok)
      throw new Error(
        `The content image ${logicalName} could not be downloaded.`,
      );
    const blob = await response.blob();
    const imageFile = new File([blob], file.filename, {
      type: file.media_type,
    });
    const sha256 =
      file.sha256 || (await sha256File(imageFile, { signal: args.signal }));
    imageMetadata.set(logicalName, {
      logicalName,
      originalName: file.filename,
      contentType: file.media_type,
      sizeBytes: file.size_bytes,
      sha256,
    });
    resources.push({ logicalName, file: imageFile, sha256 });
  }
  return {
    document: createSceneEffectDocumentFromDefinition({
      name: args.name,
      description: args.description,
      definition,
      images: imageMetadata,
      sound: exactSoundFromPreview(preview),
    }),
    images: resources,
  };
}

function exactSoundFromPreview(
  preview: PyContentPreview,
): SceneEffectEditorSound | null {
  const dependencies = Array.isArray(preview.metadata.dependencies)
    ? preview.metadata.dependencies
    : [];
  const edge = dependencies.find((value): value is PyContentDependency =>
    Boolean(
      object(value)?.content_type === "sound_effect" &&
      typeof object(value)?.alias === "string" &&
      object(object(value)?.source)?.type,
    ),
  );
  if (!edge) return null;
  const supports = Array.isArray(preview.metadata.supports)
    ? preview.metadata.supports
    : [];
  const referenceMap = object(preview.metadata.reference_map);
  const runtimeId = referenceMap?.[edge.alias];
  const support = supports.find(
    (value) => object(value)?.runtime_id === runtimeId,
  );
  return {
    alias: edge.alias,
    label: String(object(support)?.name ?? edge.alias),
    source: edge.source,
  };
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function sceneSaveFingerprint(
  document: SceneEffectEditorDocument,
  resources: SceneEffectEditorImageResource[],
) {
  return `${sceneEffectDocumentFingerprint(document)}:${[...resources]
    .sort((left, right) => left.logicalName.localeCompare(right.logicalName))
    .map((resource) => `${resource.logicalName}:${resource.sha256}`)
    .join("|")}`;
}

function soundSourceKey(source: PyExactContentSource | null): string {
  if (!source) return "none";
  return source.type === "builtin"
    ? `builtin:${source.content_id ?? ""}:${source.version ?? ""}`
    : `catalog:${source.catalog_item_id}`;
}

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
