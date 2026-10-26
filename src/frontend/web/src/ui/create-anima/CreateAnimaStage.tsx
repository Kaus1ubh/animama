import { useFrame, useThree } from "@react-three/fiber";
import { Upload } from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { getI18n, useTranslation } from "react-i18next";
import { PerspectiveCamera, type Object3D } from "three";

import type {
  ItemRevisionRef,
  PyTypedContentPreview,
} from "@animama/runtime-contracts/sdk";
import { Avatar } from "@/lib/avatar";
import { acquireContentPreviewResource } from "@/lib/content-preview/lifecycle";
import { apiErrorLine } from "@/lib/errors/apiError";
import { VerifiedByteLoader } from "@/lib/runtime-content/VerifiedByteLoader";
import { useAvatarFaceParts } from "@/query/hooks/useAvatarFaceParts";
import { useAvatarLoadSettings } from "@/query/hooks/useAvatarSettings";
import type { SceneVFXRuntimeEntry } from "@/lib/scene-vfx/types";
import { AvatarPreviewSurface } from "@/ui/avatar-preview/AvatarPreviewSurface";
import { Button } from "@/ui/components/button";
import {
  CreateAnimaPreviewSession,
  type CreationPreviewStatus,
} from "./CreateAnimaPreviewSession";
import { CreatorError, creatorErrorText } from "./createAnimaErrors";
import { useCreationPortraitCapture } from "./createAnimaPortrait";

export type CreationStageHandle = {
  stop: () => void;
  play: (load: (signal: AbortSignal) => Promise<PyTypedContentPreview>) => void;
};
type Props = {
  ref?: Ref<CreationStageHandle>;
  avatar: ItemRevisionRef | null;
  file: File | null;
  loadAvatar: (
    source: ItemRevisionRef,
    signal: AbortSignal,
  ) => Promise<PyTypedContentPreview>;
  onUpload: () => void;
  suspended: boolean;
  onFinished: () => void;
  /** The shown Avatar revision when it needs a portrait (`creationPortraitTarget`). */
  portraitTarget?: ItemRevisionRef | null;
  savePortrait?: (
    target: ItemRevisionRef,
    blob: Blob,
    signal: AbortSignal,
  ) => Promise<void>;
};

class StageBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? <StageUnavailable /> : this.props.children;
  }
}

function StageUnavailable() {
  const { t } = useTranslation("create");
  return <p className="p-8 text-sm">{t("stage.unavailable")}</p>;
}

/** Persistent stage shell: one Canvas, no floating dock, no existing-Anima runtime. */
export function CreateAnimaStage({
  ref,
  avatar,
  file,
  loadAvatar,
  onUpload,
  suspended,
  onFinished,
  portraitTarget = null,
  savePortrait,
}: Props) {
  const { t } = useTranslation("create");
  const reducedMotion = useReducedMotion() === true;
  const [visible, setVisible] = useState(true);
  const [status, setStatus] = useState<CreationPreviewStatus>("empty");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [sceneVfx, setSceneVfx] = useState<SceneVFXRuntimeEntry | null>(null);
  const [loadedAvatar, setLoadedAvatar] = useState<Avatar | null>(null);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const statusRef = useRef(status);
  statusRef.current = status;
  const report = useCallback((next: CreationPreviewStatus, detail = "") => {
    setStatus(next);
    setMessage(detail);
  }, []);
  const session = useMemo(
    () =>
      new CreateAnimaPreviewSession(report, setSceneVfx, () =>
        finishedRef.current(),
      ),
    [report],
  );
  const active = !suspended && visible;
  const stop = useCallback(() => {
    session.stop();
    if (["preparing", "playing"].includes(statusRef.current)) report("stopped");
  }, [session, report]);
  useEffect(() => {
    const release = acquireContentPreviewResource("creator", "catalog");
    return () => {
      session.dispose();
      release();
    };
  }, [session]);
  useEffect(() => {
    const handle = () => {
      setVisible(!document.hidden);
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
  }, [stop]);
  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);
  useEffect(() => {
    stop();
  }, [avatar?.item_id, avatar?.revision_sha256, file, stop]);

  useImperativeHandle(
    ref,
    () => ({
      stop,
      play: (load) => {
        if (!active) return;
        void session.play(load);
      },
    }),
    [active, session, stop],
  );

  const sourceKey = file
    ? `file:${file.name}:${file.size}:${file.lastModified}`
    : avatar
      ? `${avatar.item_id}:${avatar.revision_sha256}`
      : "empty";
  // Stable across language changes: the actor reloads its model when this changes.
  const contextError = useCallback(() => {
    stop();
    const fixedT = getI18n().getFixedT(null, "create");
    report("error", fixedT("stage.webglUnavailable"));
  }, [report, stop]);
  return (
    <section
      aria-label={t("stage.label")}
      data-testid="create-anima-stage"
      className="relative h-full min-h-[340px] min-w-0 overflow-hidden bg-transparent"
    >
      <div className="absolute inset-0">
        {sourceKey === "empty" ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-24 rounded-full"
              aria-label={t("stage.upload")}
              disabled={suspended}
              onClick={onUpload}
            >
              <Upload className="size-10" aria-hidden="true" />
            </Button>
            <p>{t("stage.empty")}</p>
          </div>
        ) : (
          <StageBoundary key={retry} onError={contextError}>
            <AvatarPreviewSurface
              active={active && status === "playing"}
              activeAvatar={loadedAvatar}
              cameraProfile="portrait"
              lifecycleOwner="creator"
              canvasTestId="create-anima-canvas"
              enableDamping={!reducedMotion}
              sceneVFX={sceneVfx}
            >
              <Suspense fallback={null}>
                <CreationStageActor
                  key={`${sourceKey}:${retry}`}
                  file={file}
                  source={avatar}
                  loadAvatar={loadAvatar}
                  session={session}
                  active={active}
                  reducedMotion={reducedMotion}
                  report={report}
                  onAvatar={setLoadedAvatar}
                  onContextError={contextError}
                  portraitTarget={portraitTarget}
                  savePortrait={savePortrait}
                  previewing={["preparing", "playing"].includes(status)}
                />
              </Suspense>
            </AvatarPreviewSurface>
          </StageBoundary>
        )}
        {["loading", "preparing", "error"].includes(status) ? (
          <div
            role={status === "error" ? "alert" : "status"}
            className="bg-background/90 absolute inset-x-3 top-20 flex items-center justify-center gap-3 rounded-lg px-3 py-2 text-center text-sm"
          >
            <span>{message || t("stage.preparing")}</span>
            {status === "error" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  stop();
                  setRetry((value) => value + 1);
                }}
              >
                {t("stage.retry")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CreationStageActor({
  file,
  source,
  loadAvatar,
  session,
  active,
  reducedMotion,
  report,
  onAvatar,
  onContextError,
  portraitTarget,
  savePortrait,
  previewing,
}: {
  file: File | null;
  source: ItemRevisionRef | null;
  loadAvatar: Props["loadAvatar"];
  session: CreateAnimaPreviewSession;
  active: boolean;
  reducedMotion: boolean;
  report: (status: CreationPreviewStatus, message?: string) => void;
  onAvatar: (avatar: Avatar | null) => void;
  onContextError: () => void;
  portraitTarget: ItemRevisionRef | null;
  savePortrait: Props["savePortrait"];
  /** A Gesture or Reaction preview is posing the Avatar. */
  previewing: boolean;
}) {
  const { camera, gl, invalidate, scene } = useThree();
  const [object, setObject] = useState<Object3D | null>(null);
  const avatarRef = useRef<Avatar | null>(null);
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  // Parts match the chat's: apply the saved Avatar's face part correction.
  const savedItemId = file ? null : (source?.item_id ?? null);
  const faceParts = useAvatarFaceParts(savedItemId);
  // An unsaved file loads with Automatic settings.
  const { springMode, springModeRef, materialMode } =
    useAvatarLoadSettings(savedItemId);
  useEffect(() => {
    avatarRef.current?.setSpringMode(springMode);
  }, [object, springMode]);
  const savedCorrection = faceParts.data?.face_parts ?? null;
  useEffect(() => {
    const avatar = avatarRef.current;
    if (!object || !avatar || !savedCorrection) return;
    void avatar
      .setFacePartCorrections(savedCorrection)
      .then(() => invalidate());
  }, [invalidate, object, savedCorrection]);
  useEffect(() => {
    // Materials are built at load; wait for the Avatar's setting.
    if (!materialMode) return;
    const controller = new AbortController();
    const avatar = new Avatar(camera, gl.domElement, {
      motionCatalog: session.catalog,
      mediaCatalog: session.catalog,
    });
    const release = acquireContentPreviewResource("creator", "avatar");
    avatar.setAutomaticAnimationPlaybackEnabled(false);
    avatarRef.current = avatar;
    const detach = session.bind(avatar);
    let objectUrl: string | null = null;
    // Worded once per load; a language change must not reload the model.
    const t = getI18n().getFixedT(null, "create");
    report("loading", t("stage.loadingAvatar"));
    void (async () => {
      try {
        let blob: Blob;
        // A saved Avatar's digest matches its saved face part correction.
        let vrmSha256: string | null = null;
        if (file) blob = file;
        else {
          const preview = await loadAvatar(source!, controller.signal);
          const model = preview.files.find(
            (item) => item.role === "model" || item.role === "vrm",
          );
          if (!model) throw new CreatorError(t("stage.noModel"));
          vrmSha256 = model.sha256 ?? null;
          blob = (await new VerifiedByteLoader().load(model, controller.signal))
            .blob;
        }
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        await avatar.load({
          filePath: objectUrl,
          vrmSha256,
          springMode: springModeRef.current,
          materialMode,
        });
        if (controller.signal.aborted) {
          avatar.dispose();
          return;
        }
        avatar.setAutomaticAnimationPlaybackEnabled(false);
        avatar.setSpringBonePhysicsEnabled(!reducedMotionRef.current);
        avatar.vrm?.update(0);
        setObject(avatar.scene);
        onAvatar(avatar);
        report("ready");
        invalidate();
      } catch (error) {
        if (!controller.signal.aborted)
          report(
            "error",
            apiErrorLine(creatorErrorText(error, t("stage.avatarUnavailable"))),
          );
      }
    })();
    const lost = (event: Event) => {
      event.preventDefault();
      onContextError();
    };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      controller.abort();
      detach();
      // A material change reloads in this actor; never draw the disposed scene.
      setObject(null);
      avatar.dispose();
      release();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      avatarRef.current = null;
      onAvatar(null);
      gl.domElement.removeEventListener("webglcontextlost", lost);
    };
    // The actor is keyed by exact source. Reduced-motion changes do not reload the model.
  }, [
    camera,
    file,
    gl,
    invalidate,
    loadAvatar,
    materialMode,
    onAvatar,
    onContextError,
    report,
    session,
    source,
    springModeRef,
  ]);
  useEffect(() => {
    avatarRef.current?.setSpringBonePhysicsEnabled(!reducedMotion);
  }, [reducedMotion]);
  const capturePortrait = useCallback(
    async (signal: AbortSignal) => {
      const avatar = avatarRef.current;
      if (!avatar) throw new Error("The Avatar left the stage.");
      const { captureAvatarPortrait } = await import("@/lib/avatar/portrait");
      // A front camera, so the user's orbit does not turn the portrait.
      return captureAvatarPortrait({
        avatar,
        renderer: gl,
        scene,
        camera: new PerspectiveCamera(),
        signal,
      });
    },
    [gl, scene],
  );
  useCreationPortraitCapture({
    // At rest only: never an unsaved file, never a preview's pose.
    ready: object !== null && file === null && !previewing,
    source,
    target: portraitTarget,
    capture: capturePortrait,
    save: savePortrait,
  });
  useFrame((_state, delta) => {
    if (active) session.tick(delta);
  });
  return object ? <primitive object={object} dispose={null} /> : null;
}
