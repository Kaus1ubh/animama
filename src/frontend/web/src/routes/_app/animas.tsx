import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/animas")({
  component: AnimasLayout,
});

function AnimasLayout() {
  return <Outlet />;
}
