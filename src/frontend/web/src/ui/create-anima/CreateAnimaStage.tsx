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
import type { Object3D } from "three";

import type { ItemRevisionRef, PyTypedContentPreview } from "@animama/runtime-contracts/sdk";
import { Avatar } from "@/lib/avatar";
import { acquireContentPreviewResource } from "@/lib/content-preview/lifecycle";
import { VerifiedByteLoader } from "@/lib/runtime-content/VerifiedByteLoader";
import type { SceneVFXRuntimeEntry } from "@/lib/scene-vfx/types";
import { AvatarPreviewSurface } from "@/ui/avatar-preview/AvatarPreviewSurface";
import { Button } from "@/ui/components/button";
import {
  CreateAnimaPreviewSession,
  type CreationPreviewStatus,
} from "./CreateAnimaPreviewSession";

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
    return this.state.failed ? (
      <p className="p-8 text-sm">
        The Avatar preview is unavailable. Your form is still editable.
      </p>
    ) : (
      this.props.children
    );
  }
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
}: Props) {
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
  const contextError = useCallback(() => {
    stop();
    report(
      "error",
      "WebGL is unavailable. Retry preview, or continue with the selected Avatar.",
    );
  }, [report, stop]);
  return (
    <section
      aria-label="Your Anima preview"
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
              aria-label="Upload a VRM file"
              disabled={suspended}
              onClick={onUpload}
            >
              <Upload className="size-10" aria-hidden="true" />
            </Button>
            <p>
              Upload a VRM (&lt;100 MB) or choose an Avatar to see them here.
            </p>
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
            <span>{message || "Preparing preview…"}</span>
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
                Retry preview
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
}) {
  const { camera, gl, invalidate } = useThree();
  const [object, setObject] = useState<Object3D | null>(null);
  const avatarRef = useRef<Avatar | null>(null);
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  useEffect(() => {
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
    report("loading", "Loading the selected Avatar…");
    void (async () => {
      try {
        let blob: Blob;
        if (file) blob = file;
        else {
          const preview = await loadAvatar(source!, controller.signal);
          const model = preview.files.find(
            (item) => item.role === "model" || item.role === "vrm",
          );
          if (!model)
            throw new Error("The selected Avatar has no registered model.");
          blob = (await new VerifiedByteLoader().load(model, controller.signal))
            .blob;
        }
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        await avatar.load({ filePath: objectUrl });
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
            error instanceof Error
              ? error.message
              : "Avatar preview is unavailable.",
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
    onAvatar,
    onContextError,
    report,
    session,
    source,
  ]);
  useEffect(() => {
    avatarRef.current?.setSpringBonePhysicsEnabled(!reducedMotion);
  }, [reducedMotion]);
  useFrame((_state, delta) => {
    if (active) session.tick(delta);
  });
  return object ? <primitive object={object} dispose={null} /> : null;
}
