import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { NeutralToneMapping } from "three";

import { installAvatarShaderRendering } from "./applyAvatarShader";
import { useAvatarShaderStore } from "./avatarShader";
import { useAvatarShaderLookStore } from "./avatarShaderLook";

/**
 * Mount inside a Canvas whose Avatar should draw the active shader's extra
 * passes and follow the debug panel's exposure and tone mapping.
 */
export function AvatarShaderRendering() {
  const gl = useThree((state) => state.gl);
  const shader = useAvatarShaderStore((state) => state.shader);
  const exposure = useAvatarShaderLookStore((state) => state.look.exposure);
  const neutral = useAvatarShaderLookStore(
    (state) => state.look.toneMapping === "neutral",
  );

  useEffect(() => {
    if (shader !== "liltoon") return;
    let release: (() => void) | null = null;
    let cancelled = false;
    void installAvatarShaderRendering(gl).then((next) => {
      if (cancelled) next();
      else release = next;
    });
    return () => {
      cancelled = true;
      release?.();
    };
  }, [gl, shader]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const previous = gl.toneMappingExposure;
    gl.toneMappingExposure = exposure;
    return () => {
      gl.toneMappingExposure = previous;
    };
  }, [gl, exposure]);

  useEffect(() => {
    if (!import.meta.env.DEV || !neutral) return;
    // three recompiles the affected programs when the curve changes.
    const previous = gl.toneMapping;
    gl.toneMapping = NeutralToneMapping;
    return () => {
      gl.toneMapping = previous;
    };
  }, [gl, neutral]);

  return null;
}
