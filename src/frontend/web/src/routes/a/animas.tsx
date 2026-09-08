import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/a/animas")({
  component: AnimasLayout,
});

function AnimasLayout() {
  return <Outlet />;
}
