import type { Camera, Object3D } from "three";

/** Observe a main-canvas mesh draw, then release optional work on the following frame. */
export function observeFirstPosedFrame(
  scene: Object3D,
  camera: Camera,
  onFrame: () => void,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancel: (handle: number) => void = cancelAnimationFrame,
) {
  let rendered = false;
  let disposed = false;
  let handle: number | null = null;
  const restorers: Array<() => void> = [];
  const restore = () => {
    for (const fn of restorers) fn();
    restorers.length = 0;
  };
  scene.traverse((object) => {
    // Group/Object3D callbacks aren't called by WebGLRenderer. Only an actual
    // drawable proves visibility; a shadow pass or offscreen render does not.
    if (!("isMesh" in object) || !object.isMesh) return;
    const original = object.onAfterRender;
    const observe: Object3D["onAfterRender"] = function (
      this: Object3D,
      ...args
    ) {
      original.apply(this, args);
      if (
        rendered ||
        disposed ||
        args[2] !== camera ||
        args[0].getRenderTarget() !== null
      )
        return;
      rendered = true;
      restore();
      handle = schedule(() => {
        handle = null;
        if (!disposed) onFrame();
      });
    };
    object.onAfterRender = observe;
    restorers.push(() => {
      if (object.onAfterRender === observe) object.onAfterRender = original;
    });
  });
  if (!restorers.length)
    throw new Error("The avatar has no renderable meshes.");
  return {
    get rendered() {
      return rendered;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      restore();
      if (handle !== null) cancel(handle);
      handle = null;
    },
  };
}
