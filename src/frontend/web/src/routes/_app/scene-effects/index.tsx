import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/scene-effects/")({
  beforeLoad: () => {
    throw redirect({ to: "/scene-effects/new", replace: true });
  },
});
