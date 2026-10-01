import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$animaId/c/$chatId")({
  component: AnimaChatRoute,
});

function AnimaChatRoute() {
  // ChatInterface is owned by the /$animaId layout so chat-id URL changes
  // do not remount TTS/avatar/SSE runtime effects.
  return null;
}
