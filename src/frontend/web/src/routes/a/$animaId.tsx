import {
  Outlet,
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useCallback } from "react";
import { CompanionSafetyProvider } from "@/ui/safety/CompanionSafetyProvider";
import { AvatarOnlySafetyOverlay } from "@/ui/safety/CompanionSafetySlot";

import { useRememberLastActiveAnima } from "@/hooks/useRememberLastActiveAnima";
import { AnimaRouteProviders } from "@/ui/app/AnimaRouteProviders";
import { ChatInterface } from "@/ui/main/chat/ChatInterface";
import { MainShell } from "@/ui/main/MainShell";

export const Route = createFileRoute("/a/$animaId")({
  component: AnimaRuntimeLayout,
});

function AnimaRuntimeLayout() {
  const { animaId } = Route.useParams();
  useRememberLastActiveAnima(animaId);
  const params = useParams({ strict: false });
  const chatId = typeof params?.chatId === "string" ? params.chatId : null;
  const navigate = useNavigate();
  const replaceChatRoute = useCallback(
    (nextChatId: string) =>
      navigate({
        to: "/a/$animaId/c/$chatId",
        params: { animaId, chatId: nextChatId },
        replace: true,
      }),
    [navigate, animaId],
  );
  const openDraftChatRoute = useCallback(
    () =>
      navigate({
        to: "/a/$animaId",
        params: { animaId },
      }),
    [navigate, animaId],
  );

  return (
    <AnimaRouteProviders>
      <CompanionSafetyProvider key={animaId}>
        <MainShell
          avatarOnlyOverlay={<AvatarOnlySafetyOverlay />}
          chatPanel={({ canvasMode }) => (
            <ChatInterface
              key={animaId}
              layout={canvasMode === "chat" ? "chat-only" : "scene-overlay"}
              animaId={animaId}
              chatId={chatId}
              openDraftChatRoute={openDraftChatRoute}
              replaceChatRoute={replaceChatRoute}
            />
          )}
        >
          <Outlet />
        </MainShell>
      </CompanionSafetyProvider>
    </AnimaRouteProviders>
  );
}
