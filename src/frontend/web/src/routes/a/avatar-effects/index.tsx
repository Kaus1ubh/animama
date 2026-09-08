import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/a/avatar-effects/")({
  beforeLoad: () => {
    throw redirect({ to: "/a/avatar-effects/new", replace: true });
  },
});
