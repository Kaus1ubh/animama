import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/avatar-effects/")({
  beforeLoad: () => {
    throw redirect({ to: "/avatar-effects/new", replace: true });
  },
});
