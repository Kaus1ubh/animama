import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

import {
  applyAvatarToneMapping,
  useEnhancedRenderingStore,
} from "@/lib/avatar/enhanced-rendering/enhancedRendering";
import { installLilToonRenderingWhenLoaded } from "@/lib/avatar/liltoon/lilToon";
import { avatarSceneLights } from "./sceneCameraPresets";

/**
 * The lights and tone mapping of an Avatar canvas, classic or enhanced per
 * the "Enable enhanced renderer and shaders" setting, plus lilToon's render
 * passes once an Avatar with lilToon materials has loaded. `lights={false}` keeps
 * only the tone mapping, for canvases that bring their own lights.
 * `measureLilToonGpu` (the main Avatar canvas, never Picture in Picture or
 * previews) times lilToon frames whenever the Materials setting's Automatic
 * needs a measurement (`lilToonGpuCheck.ts`).
 */
export function AvatarSceneLighting({
  lights = true,
  measureLilToonGpu = false,
}: {
  lights?: boolean;
  measureLilToonGpu?: boolean;
}) {
  const gl = useThree((state) => state.gl);
  const enhanced = useEnhancedRenderingStore((state) => state.enabled);

  useEffect(() => {
    // three recompiles the affected programs when the curve changes.
    applyAvatarToneMapping(gl, enhanced);
  }, [gl, enhanced]);

  // lilToon's outline and extra passes, once an Avatar has loaded lilToon.
  useEffect(
    () =>
      installLilToonRenderingWhenLoaded(gl, { measureGpu: measureLilToonGpu }),
    [gl, measureLilToonGpu],
  );

  if (!lights) return null;
  const { ambientIntensity, directional } = avatarSceneLights(enhanced);
  return (
    <>
      <ambientLight intensity={ambientIntensity} />
      {directional.map((light, index) => (
        <directionalLight
          key={index}
          position={light.position}
          intensity={light.intensity}
          color={light.color ?? "#ffffff"}
        />
      ))}
    </>
  );
}
