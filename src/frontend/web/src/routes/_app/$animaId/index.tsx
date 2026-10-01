import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$animaId/")({
  component: AnimaRuntimeRoute,
});

function AnimaRuntimeRoute() {
  // ChatInterface is owned by the /$animaId layout so runtime effects
  // survive the first-chat redirect into /c/$chatId.
  return null;
}
