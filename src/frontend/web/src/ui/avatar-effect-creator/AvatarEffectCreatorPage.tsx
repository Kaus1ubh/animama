"use client";

import { AvatarEffectAnimationControls } from "./AvatarEffectAnimationControls";

import { SoundUploadButton } from "@/ui/sound-upload/SoundUploadButton";

import { ContentEditorHydration } from "@/lib/content/contentEditorSource";

import { useFrame } from "@react-three/fiber";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  Code2Icon,
  FileImageIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  SparklesIcon,
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
import {
  avatarEffectDocumentFingerprint,
  avatarEffectEditorReducer,
  avatarEffectRuntimeEntry,
  buildAvatarEffectEditorExport,
  canonicalAvatarEffectImageName,
  createAvatarEffectDocumentFromDefinition,
  createDefaultAvatarEffectDocument,
  clearAvatarEffectRecovery,
  parseAvatarEffectEditorExport,
  validateAvatarEffectDocument,
  type AvatarEffectEditorDocument,
  type AvatarEffectEditorImageResource,
} from "@/lib/avatar/vfx/editor";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import type {
  AvatarVFXCatalogEntry,
  AvatarVFXSnapshot,
  AvatarVFXTransform,
} from "@/lib/avatar/vfx/types";
import {
  contentPreviewPrimaryFile,
  fetchContentPreviewFile,
} from "@/lib/content/contentPreview";
import { preflightContentFile, sha256File } from "@/lib/content/contentUploads";
import { useAvatarEffect, useSoundEffects } from "@/query/hooks/useEffects";
import { AvatarPreviewSurface } from "@/ui/avatar-preview/AvatarPreviewSurface";
import { PlaybackObservationOutput } from "@/ui/avatar-preview/PlaybackObservationOutput";
import { useContentPreviewAudio } from "@/ui/content-preview/useContentPreviewAudio";
import type { ContentCreatorModelSource } from "@/ui/content-creator/contentCreatorModelPreview";
import { useContentCreatorAvatar } from "@/ui/content-creator/useContentCreatorAvatar";
import { useContentCreatorModelPreview } from "@/ui/content-creator/useContentCreatorModelPreview";
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
  CreatorToggleRow as SwitchRow,
  CreatorToolbar,
  CreatorWorkspaceShell,
} from "@/ui/content-creator";
import { ContentHealth } from "@/ui/content-health/ContentHealth";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { Label } from "@/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import { Textarea } from "@/ui/components/textarea";
import { cn } from "@/lib/utils";
import {
  AVATAR_EFFECT_PREVIEW_MOTION_CLASS,
  avatarEffectCreatorKeyboardAction,
  avatarEffectPreviewCompatibility,
  createAvatarEffectObjectUrlLease,
  shouldBlockAvatarEffectNavigation,
} from "./avatarEffectCreatorBehavior";
import { useAvatarEffectSave } from "./useAvatarEffectSave";
import { useAvatarEffectHistory } from "./useAvatarEffectHistory";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const PREVIEW_EFFECT_ID = "avatar-effect-creator-live-preview";

type PreviewStatus = {
  state: "idle" | "loading" | "ready" | "error";
  message: string | null;
};

type HydrationState = PreviewStatus;

export function AvatarEffectCreatorPage({ itemId }: { itemId?: string }) {
  const navigate = useNavigate();
  const userId = useRuntimeOwnerId();
  const existingQuery = useAvatarEffect(itemId ?? null);
  const { document, imageResource, history, dispatch, resetDocument } =
    useAvatarEffectHistory();
  const [selectedModel, setSelectedModel] =
    useState<ContentCreatorModelSource | null>(null);
  const [previewAvatar, setPreviewAvatar] = useState<Avatar | null>(null);
  const [avatarStatus, setAvatarStatus] = useState<PreviewStatus>({
    state: "idle",
    message: null,
  });
  const [vfxSnapshot, setVfxSnapshot] = useState<AvatarVFXSnapshot | null>(
    null,
  );
  const [modelCompatible, setModelCompatible] = useState<boolean | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [cameraProfile, setCameraProfile] = useState<
    "portrait" | "portrait-close"
  >("portrait-close");
  const [hydration, setHydration] = useState<HydrationState>({
    state: itemId ? "loading" : "ready",
    message: null,
  });
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // Snapshot updates must not recreate the definition and restart playback.
  const previewEffect = useMemo(
    () => (imageUrl ? safeRuntimeEntry(document, imageUrl) : null),
    [document, imageUrl],
  );
  const [soundPreview, setSoundPreview] = useState<PyContentPreview | null>(
    null,
  );
  const hydratedItemRef = useRef(new ContentEditorHydration());
  const initialFingerprintRef = useRef(
    `${avatarEffectDocumentFingerprint(document)}:missing`,
  );

  const onRestore = useCallback(
    (
      recoveredDocument: AvatarEffectEditorDocument,
      recoveredImage: AvatarEffectEditorImageResource | null,
    ) => {
      resetDocument(recoveredDocument, recoveredImage);
      setHydration({ state: "ready", message: "Recovered local draft" });
      setPreviewRevision((value) => value + 1);
    },
    [resetDocument],
  );
  const onSaved = useCallback(
    (savedDocument: AvatarEffectEditorDocument, savedItemId: string) => {
      dispatch({ type: "patch", patch: { name: savedDocument.name } });
      hydratedItemRef.current.preserve(savedItemId);
      initialFingerprintRef.current = `${avatarEffectDocumentFingerprint(savedDocument)}:${imageResource?.sha256 ?? "missing"}`;
    },
    [dispatch, imageResource?.sha256],
  );

  const validation = useMemo(
    () =>
      validateAvatarEffectDocument(document, {
        imageBytesAvailable: Boolean(imageResource),
        modelCompatible,
      }),
    [document, imageResource, modelCompatible],
  );
  const hasBlockingIssues = validation.some(
    (issue) => issue.severity === "error",
  );
  const contentSave = useAvatarEffectSave({
    itemId,
    document,
    imageResource,
    initialized: hydration.state === "ready",
    ready: !hasBlockingIssues && !imageBusy && hydration.state === "ready",
    onRestore,
    onSaved,
  });

  const currentFingerprint = `${avatarEffectDocumentFingerprint(document)}:${imageResource?.sha256 ?? "missing"}`;
  const isDirty = currentFingerprint !== initialFingerprintRef.current;
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      shouldBlockAvatarEffectNavigation({
        dirty: isDirty,
        busy: contentSave.isBusy,
        currentPath: current.pathname,
        nextPath: next.pathname,
      }),
    enableBeforeUnload: () => isDirty || contentSave.isBusy,
    withResolver: true,
  });

  const modelPreview = useContentCreatorModelPreview({
    ownerKey: `avatar-effect-creator:${itemId ?? "new"}`,
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
    if (!imageResource) {
      setImageUrl(null);
      return;
    }
    const lease = createAvatarEffectObjectUrlLease(imageResource.file);
    setImageUrl(lease.url);
    return lease.dispose;
  }, [imageResource]);

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
        message: "This Avatar Effect is unavailable.",
      });
      return;
    }
    const controller = new AbortController();
    setHydration({ state: "loading", message: "Loading saved content…" });
    void hydrateAvatarEffect({
      itemId: item.item_id,
      name: item.name,
      description: item.description ?? "",
      signal: controller.signal,
    })
      .then(({ document: loadedDocument, image }) => {
        if (controller.signal.aborted) return;
        load.complete();
        resetDocument(loadedDocument, image);
        initialFingerprintRef.current =
          item.origin === "builtin"
            ? "__included_copy__"
            : `${avatarEffectDocumentFingerprint(loadedDocument)}:${image.sha256}`;
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
              : "The Avatar Effect could not be opened.",
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

  const canSaveFromKeyboard = contentSave.canSave;
  const saveFromKeyboard = contentSave.save;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      const action = avatarEffectCreatorKeyboardAction({
        key: event.key,
        code: event.code,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        editing: Boolean(editing),
      });
      if (action === "save") {
        event.preventDefault();
        if (canSaveFromKeyboard) void saveFromKeyboard();
        return;
      }
      if (action === "toggle-preview") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canSaveFromKeyboard, saveFromKeyboard]);

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

  const chooseImage = useCallback(
    async (source: File) => {
      setImageError(null);
      if (!IMAGE_TYPES.has(source.type)) {
        setImageError("Choose one PNG, JPEG, or WebP image.");
        return;
      }
      if (source.size > MAX_IMAGE_BYTES) {
        setImageError("The effect image must be 16 MiB or smaller.");
        return;
      }
      setImageBusy(true);
      try {
        const preflight = await preflightContentFile("image", source);
        if (preflight.error) throw new Error(preflight.error);
        const logicalName = canonicalAvatarEffectImageName(source.name);
        const file = new File([source], logicalName, {
          type: source.type,
          lastModified: source.lastModified,
        });
        const sha256 = await sha256File(file);
        dispatch(
          {
            type: "patch",
            patch: {
              image: {
                logicalName,
                originalName: source.name,
                contentType: source.type,
                sizeBytes: source.size,
                sha256,
              },
            },
          },
          { file, sha256 },
        );
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
    [dispatch, restartPreview],
  );

  const importDocument = useCallback(() => {
    try {
      const parsed = parseAvatarEffectEditorExport(JSON.parse(importText));
      if (isDirty && !window.confirm("Replace the current unsaved document?"))
        return;
      dispatch({ type: "replace", document: parsed }, null);
      setImportError(null);
      setImportOpen(false);
      restartPreview();
      if (parsed.image) {
        toast.info("Reselect the imported document's image before saving.");
      }
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : "The JSON could not be imported.",
      );
    }
  }, [dispatch, importText, isDirty, restartPreview]);

  const startNewDocument = useCallback(async () => {
    if (contentSave.isBusy || imageBusy) return;
    if (
      isDirty &&
      !window.confirm(
        "Discard the current changes and start a new Avatar Effect?",
      )
    )
      return;

    if (itemId) {
      if (userId) await clearAvatarEffectRecovery(userId, "new");
      await navigate({
        to: "/a/avatar-effects/new",
        replace: true,
        ignoreBlocker: true,
      });
      return;
    }

    const nextDocument = createDefaultAvatarEffectDocument();
    const nextFingerprint = `${avatarEffectDocumentFingerprint(nextDocument)}:missing`;
    if (!(await contentSave.resetSession(nextFingerprint))) return;
    resetDocument(nextDocument, null);
    setImageError(null);
    setImageBusy(false);
    setVfxSnapshot(null);
    setModelCompatible(null);
    setPlaying(true);
    setJsonOpen(false);
    setImportOpen(false);
    setImportText("");
    setImportError(null);
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

  const exportText = useMemo(
    () => JSON.stringify(buildAvatarEffectEditorExport(document), null, 2),
    [document],
  );

  const patchTransform = useCallback(
    (group: keyof AvatarVFXTransform, axis: "x" | "y" | "z", value: number) => {
      dispatch({
        type: "patch",
        patch: {
          transform: {
            ...document.transform,
            [group]: { ...document.transform[group], [axis]: value },
          },
        },
      });
      restartPreview();
    },
    [dispatch, document.transform, restartPreview],
  );

  if (hydration.state === "loading" && itemId) {
    return (
      <CreatorLoading message={hydration.message ?? "Loading Avatar Effect…"} />
    );
  }

  const duration =
    document.lifetime?.kind === "duration"
      ? document.lifetime.runEndBufferSec
      : null;

  return (
    <CreatorWorkspaceShell
      bottomChromeHeight={144}
      canvas={
        <div
          className="relative size-full"
          data-playback-surface="creator-stage"
        >
          <AvatarPreviewSurface
            activeAvatar={previewAvatar}
            cameraProfile={cameraProfile}
            canvasTestId="avatar-effect-creator-canvas"
            lifecycleOwner="creator"
            minDistance={0.45}
            maxDistance={5}
            showSceneVFX={false}
            overlay={
              <>
                <div className="pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(circle_at_center,transparent_20%,hsl(var(--background)/0.18)_72%,hsl(var(--background)/0.5)_100%)]" />
                {showGuides ? <PreviewGuides /> : null}
              </>
            }
          >
            {modelPreview.modelEntry && modelPreview.modelEntryKey ? (
              <AvatarEffectPreviewActor
                entry={modelPreview.modelEntry}
                entryKey={modelPreview.modelEntryKey}
                effect={previewEffect}
                playing={playing}
                revision={previewRevision}
                onAvatarChange={setPreviewAvatar}
                onStatusChange={setAvatarStatus}
                onSnapshot={setVfxSnapshot}
                onCompatibilityChange={setModelCompatible}
              />
            ) : null}
          </AvatarPreviewSurface>
          <PlaybackObservationOutput
            active
            avatar={previewAvatar}
            sceneVFX={null}
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
                    : playing &&
                        imageUrl &&
                        (vfxSnapshot?.activeEffects.length ?? 0) > 0
                      ? "playing"
                      : "stopped"
            }
            surface="creator-stage"
            target={{
              kind: "avatar_vfx",
              runtimeId: document.name.trim() || "new-avatar-effect",
            }}
          />
        </div>
      }
      toolbar={
        <CreatorToolbar
          contentHealth={<ContentHealth compact />}
          validationMessages={[
            ...validation.map((issue) => issue.message),
            ...(vfxSnapshot?.warnings ?? []),
            ...[
              modelPreview.animaError,
              modelPreview.runtimeError,
              modelPreview.modelError,
            ].filter((message): message is string => Boolean(message)),
            ...(avatarStatus.state === "error"
              ? [avatarStatus.message ?? "Unable to load the preview Avatar."]
              : []),
            ...(hydration.state === "error"
              ? [hydration.message ?? "Unable to open effect."]
              : []),
          ]}
          history={history}
          historyDisabled={
            contentSave.isBusy ||
            imageBusy ||
            hydration.state !== "ready" ||
            !contentSave.recoveryReady
          }
          typeLabel="Avatar FX"
          contentType="avatar_effect"
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
              componentType="avatar_effect"
            />
          }
        />
      }
      leftPanelLabel="Setup"
      rightPanelLabel="Inspector"
      leftPanel={
        <EffectSetupPanel
          document={document}
          imageResource={imageResource}
          imageBusy={imageBusy}
          imageError={imageError}
          saveErrorField={contentSave.errorField}
          dragActive={dragActive}
          soundOptions={soundOptions}
          soundPending={soundQuery.isPending}
          onDispatch={(action) => {
            dispatch(action);
            restartPreview();
          }}
          onChooseImage={chooseImage}
          onClearSaveErrorField={contentSave.clearSaveErrorField}
          onDragActive={setDragActive}
        />
      }
      rightPanel={
        <InspectorPanel
          document={document}
          modelPreview={modelPreview}
          selectedModel={selectedModel}
          onDispatch={(action) => {
            dispatch(action);
            restartPreview();
          }}
          onPatchTransform={patchTransform}
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
              { value: "portrait-close", label: "Face" },
              { value: "portrait", label: "Portrait" },
            ],
            onValueChange: (value) =>
              setCameraProfile(value as typeof cameraProfile),
            triggerClassName: "w-[105px]",
          }}
          guides={showGuides}
          onGuidesChange={setShowGuides}
          onRestart={restartPreviewWithSound}
        />
      }
      previewBar={
        <CreatorPreviewBar
          title="Avatar FX"
          subtitle={document.name || "New Avatar FX"}
          playing={playing}
          onPlayingChange={setPreviewPlaying}
          onRestart={restartPreviewWithSound}
          progressClassName={AVATAR_EFFECT_PREVIEW_MOTION_CLASS}
          duration={{
            value: duration,
            label: "Run-end buffer",
            indefiniteLabel:
              document.lifetime?.kind === "turns"
                ? `${document.lifetime.turns} conversation turn${document.lifetime.turns === 1 ? "" : "s"}`
                : "Until stopped",
            min: 0.05,
            max: 30,
            step: 0.05,
            onValueChange: (seconds) =>
              dispatch({
                type: "patch",
                patch: {
                  lifetime: { kind: "duration", runEndBufferSec: seconds },
                },
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
            title="Portable Avatar Effect JSON"
            description="This document contains authoring values and exact dependency sources, but never local Blob URLs or capabilities."
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
            title="Import Avatar Effect JSON"
            description="Paste an Animama Avatar Effect editor document. Image bytes must be reselected."
            text={importText}
            error={importError}
            onTextChange={setImportText}
            onImport={importDocument}
          />
          <AvatarEffectLeaveDialog
            open={blocker.status === "blocked"}
            onOpenChange={(open) => {
              if (!open && blocker.status === "blocked") blocker.reset?.();
            }}
            busy={contentSave.isBusy}
            onStay={() => blocker.reset?.()}
            onLeave={() => blocker.proceed?.()}
          />
        </>
      }
    />
  );
}

function EffectSetupPanel({
  document,
  imageResource,
  imageBusy,
  imageError,
  saveErrorField,
  dragActive,
  soundOptions,
  soundPending,
  onDispatch,
  onChooseImage,
  onClearSaveErrorField,
  onDragActive,
}: {
  document: AvatarEffectEditorDocument;
  imageResource: AvatarEffectEditorImageResource | null;
  imageBusy: boolean;
  imageError: string | null;
  saveErrorField: string | null;
  dragActive: boolean;
  soundOptions: Array<{
    item_id: string;
    name: string;
    source: PyExactContentSource | null;
  }>;
  soundPending: boolean;
  onDispatch: React.Dispatch<Parameters<typeof avatarEffectEditorReducer>[1]>;
  onChooseImage: (file: File) => void;
  onClearSaveErrorField: (field: string) => void;
  onDragActive: (active: boolean) => void;
}) {
  return (
    <FloatingPanel title="Effect Setup" bodyClassName="overflow-y-auto">
      <Tabs
        value={document.kind}
        onValueChange={(kind) =>
          onDispatch({
            type: "set-kind",
            kind: kind as AvatarEffectEditorDocument["kind"],
          })
        }
      >
        <TabsList className="grid h-9 w-full grid-cols-3">
          <TabsTrigger value="hover" className="min-w-0 px-1 text-xs">
            Hover
          </TabsTrigger>
          <TabsTrigger value="face_anchored" className="min-w-0 px-1 text-xs">
            Face decal
          </TabsTrigger>
          <TabsTrigger value="texture" className="min-w-0 px-1 text-xs">
            Texture
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-3 space-y-3">
        <Field label="Description">
          <Textarea
            className="min-h-16 text-xs"
            rows={2}
            value={document.description}
            onChange={(event) =>
              onDispatch({
                type: "patch",
                patch: { description: event.target.value },
              })
            }
          />
        </Field>

        <Field label="Effect image" invalid={saveErrorField === "files"}>
          <label
            className={cn(
              "border-border/70 bg-background/55 hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 transition",
              dragActive && "border-sky-400 bg-sky-100/50 dark:bg-sky-950/30",
              saveErrorField === "files" && "border-destructive",
            )}
            onDragEnter={(event) => {
              event.preventDefault();
              onDragActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => onDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              onDragActive(false);
              const file = event.dataTransfer.files[0];
              if (file) {
                onClearSaveErrorField("files");
                void onChooseImage(file);
              }
            }}
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
              {imageBusy ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <FileImageIcon />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {imageResource?.file.name ??
                  document.image?.originalName ??
                  "Choose image"}
              </div>
              <div className="text-muted-foreground text-xs">
                PNG, JPEG, or WebP · up to 16 MiB
              </div>
            </div>
            <span className="border-border rounded-md border px-2 py-1 text-xs">
              {document.image ? "Replace" : "Browse"}
            </span>
            <input
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp"
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
            <p className="text-destructive mt-1 text-xs">{imageError}</p>
          ) : null}
        </Field>

        {document.kind === "hover" ? (
          <HoverFields document={document} onDispatch={onDispatch} />
        ) : document.kind === "face_anchored" ? (
          <FaceFields document={document} onDispatch={onDispatch} />
        ) : (
          <TextureFields document={document} onDispatch={onDispatch} />
        )}

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
      </div>
    </FloatingPanel>
  );
}

function HoverFields({ document, onDispatch }: EditorFieldsProps) {
  return (
    <>
      <Field label="Hover type">
        <Select
          value={document.hover.hoverKind}
          onValueChange={(hoverKind) =>
            onDispatch({
              type: "patch-hover",
              patch: {
                hoverKind: hoverKind as typeof document.hover.hoverKind,
              },
            })
          }
        >
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="eye_hover">Eye hover</SelectItem>
            <SelectItem value="mouth_hover">Mouth hover</SelectItem>
            <SelectItem value="box_hover">Face box hover</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {document.hover.hoverKind === "box_hover" ? (
        <Field label="Placement">
          <Select
            value={document.hover.placement}
            onValueChange={(placement) =>
              onDispatch({
                type: "patch-hover",
                patch: {
                  placement: placement as typeof document.hover.placement,
                },
              })
            }
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                "forehead-left",
                "forehead-middle",
                "forehead-right",
                "top-left",
                "top-middle",
                "top-right",
                "top-edge-left-corner",
                "top-edge-left",
                "top-edge-middle",
                "top-edge-right",
                "top-edge-right-corner",
              ].map((placement) => (
                <SelectItem key={placement} value={placement}>
                  {humanize(placement)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      {document.hover.hoverKind === "eye_hover" ? (
        <SideField
          value={document.hover.side}
          onValue={(side) =>
            onDispatch({ type: "patch-hover", patch: { side } })
          }
        />
      ) : null}
      {document.hover.hoverKind !== "box_hover" ? (
        <SwitchRow
          label="Skin backdrop"
          description="Place a face-color backing below transparent art."
          checked={document.hover.skinBackdrop}
          onChecked={(skinBackdrop) =>
            onDispatch({ type: "patch-hover", patch: { skinBackdrop } })
          }
        />
      ) : null}
      {document.hover.hoverKind === "eye_hover" ? (
        <SwitchRow
          label="Mirror right eye"
          checked={document.hover.requiresMirror}
          onChecked={(requiresMirror) =>
            onDispatch({ type: "patch-hover", patch: { requiresMirror } })
          }
        />
      ) : null}
    </>
  );
}

function FaceFields({ document, onDispatch }: EditorFieldsProps) {
  return (
    <>
      <Field label="Anchor">
        <Select
          value={document.face.anchor}
          onValueChange={(anchor) =>
            onDispatch({
              type: "patch-face",
              patch: { anchor: anchor as typeof document.face.anchor },
            })
          }
        >
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="undereye">Under eye</SelectItem>
            <SelectItem value="blush">Blush</SelectItem>
            <SelectItem value="mouth">Mouth</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {document.face.anchor !== "mouth" ? (
        <>
          <Field label="Layout">
            <Select
              value={document.face.layout}
              onValueChange={(layout) =>
                onDispatch({
                  type: "patch-face",
                  patch: { layout: layout as "single" | "span" },
                })
              }
            >
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single side</SelectItem>
                <SelectItem value="span">Span face</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {document.face.layout === "single" ? (
            <SideField
              value={document.face.side}
              allowBoth={false}
              onValue={(side) =>
                onDispatch({
                  type: "patch-face",
                  patch: { side: side ?? "left" },
                })
              }
            />
          ) : null}
        </>
      ) : null}
      <Field label="Image pivot">
        <Select
          value={document.face.pivot}
          onValueChange={(pivot) =>
            onDispatch({
              type: "patch-face",
              patch: { pivot: pivot as typeof document.face.pivot },
            })
          }
        >
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[
              "top-left",
              "top-center",
              "top-right",
              "center-left",
              "center",
              "center-right",
              "bottom-left",
              "bottom-center",
              "bottom-right",
            ].map((pivot) => (
              <SelectItem key={pivot} value={pivot}>
                {humanize(pivot)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {document.face.layout === "single" && document.face.anchor !== "mouth" ? (
        <SwitchRow
          label="Mirror opposite side"
          checked={document.face.requiresMirror}
          onChecked={(requiresMirror) =>
            onDispatch({ type: "patch-face", patch: { requiresMirror } })
          }
        />
      ) : null}
    </>
  );
}

function TextureFields({ document, onDispatch }: EditorFieldsProps) {
  return (
    <>
      <Field label="Target material role">
        <Select
          value={document.texture.targetRole}
          onValueChange={(targetRole) =>
            onDispatch({
              type: "patch-texture",
              patch: {
                targetRole: targetRole as typeof document.texture.targetRole,
              },
            })
          }
        >
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[
              "face_skin",
              "eye_iris",
              "eye_highlight",
              "eyeline",
              "eyelash",
            ].map((role) => (
              <SelectItem key={role} value={role}>
                {humanize(role)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Asset shape">
        <Select
          value={document.texture.assetShape}
          onValueChange={(assetShape) =>
            onDispatch({
              type: "patch-texture",
              patch: {
                assetShape: assetShape as typeof document.texture.assetShape,
              },
            })
          }
        >
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="single_eye">Single eye</SelectItem>
            <SelectItem value="double_eye">Double eye</SelectItem>
            <SelectItem value="full_face">Full face</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Apply mode">
        <Select
          value={document.texture.applyMode}
          onValueChange={(applyMode) =>
            onDispatch({
              type: "patch-texture",
              patch: { applyMode: applyMode as "overlay" | "replace" },
            })
          }
        >
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="overlay">Overlay</SelectItem>
            <SelectItem value="replace">Replace</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <SideField
        value={document.texture.side}
        onValue={(side) =>
          onDispatch({ type: "patch-texture", patch: { side } })
        }
      />
      <SwitchRow
        label="Mirror opposite side"
        checked={document.texture.requiresMirror}
        onChecked={(requiresMirror) =>
          onDispatch({ type: "patch-texture", patch: { requiresMirror } })
        }
      />
    </>
  );
}

type EditorFieldsProps = {
  document: AvatarEffectEditorDocument;
  onDispatch: React.Dispatch<Parameters<typeof avatarEffectEditorReducer>[1]>;
};

function InspectorPanel({
  document,
  modelPreview,
  selectedModel,
  onDispatch,
  onPatchTransform,
}: {
  document: AvatarEffectEditorDocument;
  modelPreview: ReturnType<typeof useContentCreatorModelPreview>;
  selectedModel: ContentCreatorModelSource | null;
  onDispatch: React.Dispatch<Parameters<typeof avatarEffectEditorReducer>[1]>;
  onPatchTransform: (
    group: keyof AvatarVFXTransform,
    axis: "x" | "y" | "z",
    value: number,
  ) => void;
}) {
  return (
    <FloatingPanel
      title="Inspector"
      summary={humanize(document.kind)}
      bodyClassName="overflow-y-auto"
    >
      <Tabs defaultValue="transform">
        <TabsList className="grid h-9 w-full grid-cols-2">
          <TabsTrigger value="transform" className="min-w-0 px-1 text-xs">
            Transform
          </TabsTrigger>
          <TabsTrigger value="animation" className="min-w-0 px-1 text-xs">
            Animation
          </TabsTrigger>
        </TabsList>
        <TabsContent value="transform" className="mt-3 space-y-3">
          <Field label="Preview Avatar">
            <Select
              value={selectedModel?.key ?? ""}
              onValueChange={(key) => {
                const source = modelPreview.modelOptions.find(
                  (option) => option.key === key,
                );
                if (source) modelPreview.selectModel(source);
              }}
            >
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue placeholder="Select Avatar" />
              </SelectTrigger>
              <SelectContent>
                {selectedModel &&
                !modelPreview.modelOptions.some(
                  (option) => option.key === selectedModel.key,
                ) ? (
                  <SelectItem value={selectedModel.key}>
                    {selectedModel.displayName}
                  </SelectItem>
                ) : null}
                {modelPreview.modelOptions.map((source) => (
                  <SelectItem key={source.key} value={source.key}>
                    {source.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {(["offset", "scale"] as const).map((group) => (
            <div key={group}>
              <Label className="mb-2 block capitalize">{group}</Label>
              <AvatarEffectAxisFields
                values={document.transform[group]}
                step={0.01}
                onValueChange={(axis, value) =>
                  onPatchTransform(group, axis, value)
                }
              />
            </div>
          ))}
          {document.kind === "hover" ? (
            <div>
              <Label className="mb-2 block">Rotation (degrees)</Label>
              <AvatarEffectAxisFields
                values={{
                  x: (document.transform.rotation.x * 180) / Math.PI,
                  y: (document.transform.rotation.y * 180) / Math.PI,
                  z: (document.transform.rotation.z * 180) / Math.PI,
                }}
                step={1}
                onValueChange={(axis, value) =>
                  onPatchTransform("rotation", axis, (value * Math.PI) / 180)
                }
              />
            </div>
          ) : (
            <NumberField
              label="Angle (degrees)"
              value={(document.transform.rotation.z * 180) / Math.PI}
              step={1}
              onChange={(value) =>
                onPatchTransform("rotation", "z", (value * Math.PI) / 180)
              }
            />
          )}
        </TabsContent>
        <TabsContent value="animation" className="mt-3 space-y-3">
          <AvatarEffectAnimationControls
            config={document.animationConfig}
            onChange={(animationConfig) =>
              onDispatch({ type: "patch", patch: { animationConfig } })
            }
          />
          <Field label="Lifetime mode">
            <Select
              value={document.lifetime?.kind ?? "duration"}
              onValueChange={(kind) =>
                onDispatch({
                  type: "patch",
                  patch: {
                    lifetime:
                      kind === "turns"
                        ? { kind: "turns", turns: 1 }
                        : { kind: "duration", runEndBufferSec: 2 },
                  },
                })
              }
            >
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="duration">Seconds</SelectItem>
                <SelectItem value="turns">Conversation turns</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {document.lifetime?.kind === "turns" ? (
            <NumberField
              label="Turns"
              value={document.lifetime.turns}
              min={1}
              step={1}
              onChange={(turns) =>
                onDispatch({
                  type: "patch",
                  patch: { lifetime: { kind: "turns", turns } },
                })
              }
            />
          ) : null}
        </TabsContent>
      </Tabs>
    </FloatingPanel>
  );
}

function AvatarEffectPreviewActor({
  entry,
  entryKey,
  effect,
  playing,
  revision,
  onAvatarChange,
  onStatusChange,
  onSnapshot,
  onCompatibilityChange,
}: {
  entry: Parameters<typeof useContentCreatorAvatar>[0]["entry"];
  entryKey: string;
  effect: AvatarVFXCatalogEntry | null;
  playing: boolean;
  revision: number;
  onAvatarChange: (avatar: Avatar | null) => void;
  onStatusChange: (status: PreviewStatus) => void;
  onSnapshot: (snapshot: AvatarVFXSnapshot | null) => void;
  onCompatibilityChange: (compatible: boolean | null) => void;
}) {
  const { avatar, sceneObject } = useContentCreatorAvatar({
    entry,
    entryKey,
    onAvatarChange,
    onStatusChange,
  });

  useFrame((_, delta) => {
    if (playing) avatar?.vfxController?.update(delta);
  });

  // The Avatar exists before its async model load creates the VFX controller.
  const controller = avatar?.vfxController;
  useEffect(() => {
    if (!controller || !effect || !playing) {
      controller?.clearAllEffects();
      onSnapshot(controller?.getSnapshot() ?? null);
      onCompatibilityChange(null);
      return;
    }
    let cancelled = false;
    let applySettled = false;
    const update = () => {
      const snapshot = controller.getSnapshot();
      onSnapshot(snapshot);
      onCompatibilityChange(
        avatarEffectPreviewCompatibility({
          playing,
          hasController: true,
          hasEffect: true,
          applySettled,
          activeEffectCount: snapshot.activeEffects.length,
        }),
      );
    };
    controller.clearAllEffects();
    onSnapshot(controller.getSnapshot());
    onCompatibilityChange(null);
    const unsubscribe = controller.subscribe(update);
    const apply =
      effect.kind === "hover"
        ? controller.applyHoverVFX({
            effectId: PREVIEW_EFFECT_ID,
            effectEntry: effect,
          })
        : effect.kind === "face_anchored"
          ? controller.applyFaceAnchoredVFX({
              effectId: PREVIEW_EFFECT_ID,
              effectEntry: effect,
            })
          : controller.applyTextureVFX({
              effectId: PREVIEW_EFFECT_ID,
              effectEntry: effect,
              applyMode: effect.applyMode,
            });
    void apply.finally(() => {
      applySettled = true;
      if (!cancelled) update();
    });
    return () => {
      cancelled = true;
      unsubscribe();
      controller.removeEffect(PREVIEW_EFFECT_ID);
    };
  }, [
    controller,
    effect,
    onCompatibilityChange,
    onSnapshot,
    playing,
    revision,
  ]);

  if (!sceneObject) return null;
  return <primitive object={sceneObject} dispose={null} />;
}

function PreviewGuides() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-30"
      aria-hidden="true"
    >
      <div className="absolute top-1/2 right-[25%] left-[25%] border-t border-dashed border-sky-300/65" />
      <div className="absolute top-[12%] bottom-[12%] left-1/2 border-l border-dashed border-sky-300/65" />
      <div className="absolute top-1/2 left-1/2 size-4 -translate-1/2 rounded-full border border-sky-400 bg-white/45" />
    </div>
  );
}

function SideField({
  value,
  onValue,
  allowBoth = true,
}: {
  value: "left" | "right" | null;
  onValue: (value: "left" | "right" | null) => void;
  allowBoth?: boolean;
}) {
  return (
    <Field label="Side">
      <Select
        value={value ?? "both"}
        onValueChange={(side) =>
          onValue(side === "both" ? null : (side as "left" | "right"))
        }
      >
        <SelectTrigger size="sm" className="w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowBoth ? <SelectItem value="both">Both</SelectItem> : null}
          <SelectItem value="left">Left</SelectItem>
          <SelectItem value="right">Right</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

function AvatarEffectAxisFields({
  values,
  labelPrefix = "",
  step,
  onValueChange,
}: {
  values: Record<"x" | "y" | "z", number>;
  labelPrefix?: string;
  step: number;
  onValueChange: (axis: "x" | "y" | "z", value: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {(["x", "y", "z"] as const).map((axis) => (
        <NumberField
          key={axis}
          label={`${labelPrefix}${axis.toUpperCase()}`}
          value={values[axis]}
          step={step}
          onChange={(value) => onValueChange(axis, value)}
        />
      ))}
    </div>
  );
}

function AvatarEffectLeaveDialog({
  open,
  onOpenChange,
  busy,
  onStay,
  onLeave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
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
              ? "This Avatar Effect is still being saved. Local recovery remains available when you return."
              : "This Avatar Effect has local authoring changes. Leaving will discard them from the active workspace. Local recovery remains available when you return."}
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

async function hydrateAvatarEffect(args: {
  itemId: string;
  name: string;
  description: string;
  signal: AbortSignal;
}): Promise<{
  document: AvatarEffectEditorDocument;
  image: AvatarEffectEditorImageResource;
}> {
  const preview = await previewCatalogItem(
    args.itemId,
    args.signal,
    "avatar_effect",
  );
  const file = contentPreviewPrimaryFile(preview, "image");
  if (!file) throw new Error("The content item has no editable image file.");
  const response = await fetchContentPreviewFile(preview, file, {
    signal: args.signal,
  });
  if (!response.ok)
    throw new Error("The content image could not be downloaded.");
  const blob = await response.blob();
  const imageFile = new File([blob], file.filename, { type: file.media_type });
  const sha256 =
    file.sha256 || (await sha256File(imageFile, { signal: args.signal }));
  const sound = exactSoundFromPreview(preview);
  const definition =
    preview.metadata.definition ?? object(preview.metadata.spec)?.definition;
  return {
    document: createAvatarEffectDocumentFromDefinition({
      name: args.name,
      description: args.description,
      definition,
      image: {
        logicalName: file.filename,
        originalName: file.filename,
        contentType: file.media_type,
        sizeBytes: file.size_bytes,
        sha256,
      },
      sound,
    }),
    image: { file: imageFile, sha256 },
  };
}

function exactSoundFromPreview(
  preview: PyContentPreview,
): AvatarEffectEditorDocument["sound"] {
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

function safeRuntimeEntry(
  document: AvatarEffectEditorDocument,
  imageUrl: string,
): AvatarVFXCatalogEntry | null {
  try {
    return avatarEffectRuntimeEntry(document, imageUrl);
  } catch {
    return null;
  }
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
