import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/a/scene-effects/")({
  beforeLoad: () => {
    throw redirect({ to: "/a/scene-effects/new", replace: true });
  },
});
