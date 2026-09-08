import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/a/$animaId/c/$chatId")({
  component: AnimaChatRoute,
});

function AnimaChatRoute() {
  // ChatInterface is owned by the /a/$animaId layout so chat-id URL changes
  // do not remount TTS/avatar/SSE runtime effects.
  return null;
}
