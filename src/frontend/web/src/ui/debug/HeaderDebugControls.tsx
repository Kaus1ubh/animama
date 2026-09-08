import { lazy, Suspense } from "react";
import { Boxes, Bug, SlidersHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAnimationDebugStore } from "@/stores/animation-debug-store";
import { useAnimaAnimationDebugStore } from "@/stores/anima-animation-debug-store";
import { useVRMEditorDebugStore } from "@/stores/vrm-editor-debug-store";
import { Button } from "@/ui/components/button";

const AnimationDebugModal = lazy(() =>
  import("./AnimationDebugModal").then((module) => ({
    default: module.AnimationDebugModal,
  })),
);
const VRMEditorDebugModal = lazy(() =>
  import("./VRMEditorDebugModal").then((module) => ({
    default: module.VRMEditorDebugModal,
  })),
);

/** Loaded only in opted-in development; dialog code waits for an open action. */
export default function HeaderDebugControls({
  animaLabel,
}: {
  animaLabel: string;
}) {
  const animation = useAnimationDebugStore();
  const vrm = useVRMEditorDebugStore();
  const animaOpen = useAnimaAnimationDebugStore((state) => state.isOpen);
  const toggleAnima = useAnimaAnimationDebugStore((state) => state.toggleOpen);

  return (
    <>
      {animation.target ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle animation debug modal"
          aria-pressed={animation.isOpen}
          onClick={animation.toggleOpen}
          className={cn(
            "text-muted-foreground hover:text-foreground",
            animation.isOpen && "bg-muted text-foreground",
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      ) : null}
      {vrm.target ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle VRM object debug modal"
          aria-pressed={vrm.isOpen}
          onClick={vrm.toggleOpen}
          className={cn(
            "text-muted-foreground hover:text-foreground",
            vrm.isOpen && "bg-muted text-foreground",
          )}
        >
          <Boxes className="h-4 w-4" />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Toggle anima debug panel"
        aria-pressed={animaOpen}
        onClick={toggleAnima}
        className={cn(
          "text-muted-foreground hover:text-foreground",
          animaOpen && "bg-muted text-foreground",
        )}
      >
        <Bug className="h-4 w-4" />
      </Button>
      <Suspense fallback={null}>
        {animation.isOpen ? (
          <AnimationDebugModal animaLabel={animaLabel} />
        ) : null}
        {vrm.isOpen ? <VRMEditorDebugModal animaLabel={animaLabel} /> : null}
      </Suspense>
    </>
  );
}
