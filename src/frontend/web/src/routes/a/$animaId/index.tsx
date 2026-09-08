import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/a/$animaId/")({
  component: AnimaRuntimeRoute,
});

function AnimaRuntimeRoute() {
  // ChatInterface is owned by the /a/$animaId layout so runtime effects
  // survive the first-chat redirect into /c/$chatId.
  return null;
}
