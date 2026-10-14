// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  textOnlyChatEffects,
  useProductChatSession,
} from "@animama/product-ui/chat";
import { queryKeys } from "@animama/product-ui/query";
import { afterEach, describe, expect, it } from "vitest";

import { RuntimeOwnerProvider } from "@web/app/runtime/RuntimeOwnerContext";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const sessionKey = "session";
const model = (id: string) => ({
  id,
  model: id,
  model_kind: "chat",
  model_client: "OpenAIResponsesHTTPAgent",
  api_standard: "openai-responses",
  settings: {},
});
const anima = (defaultModel: string) => ({
  id: "anima-1",
  name: "Annie",
  chat_profile: { default_model_provider_id: defaultModel },
});

/** Let TanStack Query deliver its batched (setTimeout) observer updates. */
const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("restoring a chat's model", () => {
  it("settles the switch it starts while mounting under StrictMode", async () => {
    // The Anima now defaults to model-b, but this chat last used model-a.
    let respond!: () => void;
    const patched = new Promise<void>((resolve) => {
      respond = resolve;
    });
    const transport = {
      baseUrl: "https://chat-fixture.invalid",
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        if (request.method === "PATCH" && path.endsWith("/chat-profile")) {
          await patched;
          return Response.json(anima("model-a"));
        }
        if (path.endsWith("/messages")) return Response.json({ messages: [] });
        throw new Error(`Unexpected request: ${request.method} ${path}`);
      },
    };
    // Data already loaded by another page, as when opening a chat from the
    // Library, lets the restore start on the session's first mount.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(
      queryKeys.animas.detail(sessionKey, "anima-1"),
      anima("model-b"),
    );
    queryClient.setQueryData(queryKeys.chats.detail(sessionKey, "chat-1"), {
      id: "chat-1",
      anima_id: "anima-1",
      last_model_provider_id: "model-a",
    });
    queryClient.setQueryData(queryKeys.modelProviders.all(sessionKey), [
      model("model-a"),
      model("model-b"),
    ]);
    queryClient.setQueryData(
      queryKeys.chats.messages(sessionKey, "chat-1"),
      [],
    );

    let session!: ReturnType<typeof useProductChatSession>;
    function Probe() {
      session = useProductChatSession({
        animaId: "anima-1",
        routeChatId: "chat-1",
        runtime: {
          runtimeRevision: "revision",
          canChat: true,
          remountLatest: () => {},
        },
        effects: textOnlyChatEffects,
        openDraftChatRoute: () => {},
        replaceChatRoute: () => {},
      });
      return null;
    }
    act(() => {
      root = createRoot(document.createElement("div"));
      root.render(
        <StrictMode>
          <QueryClientProvider client={queryClient}>
            <RuntimeOwnerProvider
              ownerId="owner"
              sessionKey={sessionKey}
              transport={transport}
            >
              <Probe />
            </RuntimeOwnerProvider>
          </QueryClientProvider>
        </StrictMode>,
      );
    });
    await settle();
    // The switch disables the model-switch dialog's Cancel and Confirm.
    expect(session.isConfirmingModelSwitch).toBe(true);
    respond();
    await settle();
    expect(
      queryClient.getQueryData(queryKeys.animas.detail(sessionKey, "anima-1")),
    ).toMatchObject(anima("model-a"));
    expect(session.isConfirmingModelSwitch).toBe(false);
  });
});
