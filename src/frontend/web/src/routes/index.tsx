import { Navigate, createFileRoute } from "@tanstack/react-router";

import {
  localRuntimeHomePath,
  useLocalRuntime,
} from "@web/app/local-runtime/LocalRuntimeProvider";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function HomeRoute() {
  const { state } = useLocalRuntime();
  if (state.status !== "ready") return null;
  return <Navigate to={localRuntimeHomePath(state)} replace />;
}
