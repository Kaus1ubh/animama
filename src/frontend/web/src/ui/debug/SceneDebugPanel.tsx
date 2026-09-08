import { lazy, Suspense } from "react";

import { useAnimaAnimationDebugStore } from "@/stores/anima-animation-debug-store";

const AnimaDebugPanel = lazy(() =>
  import("./AnimaDebugPanel").then((module) => ({
    default: module.AnimaDebugPanel,
  })),
);

/** Keep the inspector and its dependencies unloaded until its panel opens. */
export default function SceneDebugPanel() {
  const isOpen = useAnimaAnimationDebugStore((state) => state.isOpen);
  return isOpen ? (
    <Suspense fallback={null}>
      <AnimaDebugPanel />
    </Suspense>
  ) : null;
}
