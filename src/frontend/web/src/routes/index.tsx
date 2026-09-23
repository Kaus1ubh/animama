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
  // Entry navigation has already passed the creator's discard prompt. Navigate's
  // layout effect can run before that departed creator unregisters its blocker.
  return <Navigate to={localRuntimeHomePath(state)} replace ignoreBlocker />;
}
