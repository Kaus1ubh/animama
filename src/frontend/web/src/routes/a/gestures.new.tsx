import { createFileRoute } from "@tanstack/react-router";

import { AppShellPage } from "@/ui/app/AppShellPage";
import { GestureEditorPage } from "@/ui/gesture-editor/GestureEditorPage";
import type { ActionComponentType } from "@/query/hooks/useEffects";

const componentTypes = new Set<ActionComponentType>([
  "particle_effect",
  "avatar_effect",
  "scene_effect",
  "sound_effect",
]);

export const Route = createFileRoute("/a/gestures/new")({
  validateSearch: (
    search,
  ): { component?: string; componentType?: ActionComponentType } => ({
    ...(typeof search.component === "string"
      ? { component: search.component }
      : {}),
    ...(componentTypes.has(search.componentType as ActionComponentType)
      ? { componentType: search.componentType as ActionComponentType }
      : {}),
  }),
  component: NewGestureRoute,
});

function NewGestureRoute() {
  const { component, componentType } = Route.useSearch();
  return (
    <AppShellPage
      className="overflow-hidden"
      contentClassName="h-full max-w-none gap-0 px-0 py-0 md:px-0 lg:px-0"
      sidebarBehavior="adaptive-canvas"
    >
      <GestureEditorPage
        initialComponent={component}
        initialComponentType={componentType}
      />
    </AppShellPage>
  );
}
