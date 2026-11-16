// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  textOnlyChatEffects,
  useProductChatSession,
  type ChatAttachmentHold,
} from "@animama/product-ui/chat";
import { ChatInputTextArea } from "@animama/product-ui/components";
import { queryKeys } from "@animama/product-ui/query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RuntimeOwnerProvider } from "@/app/runtime/RuntimeOwnerContext";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const sessionKey = "session";
const QUESTION = "What does the report say about costs?";

/** Let queued state updates and promise continuations run. */
const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

type Session = ReturnType<typeof useProductChatSession>;
type RecordedRequest = {
  method: string;
  path: string;
  body: unknown;
  respond: (response: Response) => void;
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let hold: ChatAttachmentHold = "none";
let attached: string[] = [];
let recorded: RecordedRequest[] = [];
let view: { session: Session | null } = { session: null };

/** `METHOD /path` of each request so far. */
const requests = () => recorded.map(({ method, path }) => `${method} ${path}`);

/** The mounted session, as of its latest render. */
function session(): Session {
  if (!view.session) throw new Error("The composer did not render.");
  return view.session;
}

/** Mount a composer text area wired to the session, as the chat panel is. */
function mount() {
  const mounted: { session: Session | null } = { session: null };
  function Composer() {
    const chat = useProductChatSession({
      animaId: "anima-1",
      runtime: {
        runtimeRevision: "revision",
        canChat: true,
        remountLatest: async () => {},
      },
      effects: textOnlyChatEffects,
      getAttachedFileIds: () => attached,
      getAttachmentHold: () => hold,
      openDraftChatRoute: () => {},
      replaceChatRoute: () => {},
    });
    mounted.session = chat;
    return (
      <ChatInputTextArea
        value={chat.input}
        onChange={(event) => chat.setInput(event.target.value)}
        onSubmit={() => {
          void chat.handleSubmit();
        }}
      />
    );
  }
  const transport = {
    baseUrl: "https://chat-fixture.invalid",
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = await request.text();
      // A request waits until a test responds; a sent turn only has to start.
      return new Promise<Response>((respond) => {
        recorded.push({
          method: request.method,
          path: new URL(request.url).pathname,
          body: body ? JSON.parse(body) : null,
          respond,
        });
      });
    },
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.animas.detail(sessionKey, "anima-1"), {
    id: "anima-1",
    name: "Annie",
    chat_profile: { default_model_provider_id: "model-a" },
  });
  queryClient.setQueryData(queryKeys.modelProviders.all(sessionKey), [
    {
      id: "model-a",
      model: "model-a",
      model_kind: "chat",
      model_client: "OpenAIResponsesHTTPAgent",
      api_standard: "openai-responses",
      settings: {},
    },
  ]);
  container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container!);
    root.render(
      <QueryClientProvider client={queryClient}>
        <RuntimeOwnerProvider
          ownerId="owner"
          sessionKey={sessionKey}
          transport={transport}
        >
          <Composer />
        </RuntimeOwnerProvider>
      </QueryClientProvider>,
    );
  });
  return mounted;
}

function textarea(): HTMLTextAreaElement {
  const element = container?.querySelector("textarea:not([aria-hidden])");
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error("The composer text area did not render.");
  }
  return element;
}

/** Settle until `find` returns a value, for steps that take several turns. */
async function settleUntil<T>(find: () => T | undefined): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const found = find();
    if (found !== undefined) return found;
    await settle();
  }
  throw new Error("The expected state never arrived.");
}

async function pressEnter() {
  act(() => {
    textarea().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await settle();
}

beforeEach(() => {
  hold = "none";
  attached = [];
  recorded = [];
  view = mount();
  act(() => session().setInput(QUESTION));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("a send held by its attachments", () => {
  it("keeps the typed message and sends nothing while files are not ready", async () => {
    hold = "waiting";
    await pressEnter();

    expect(textarea().value).toBe(QUESTION);
    expect(session().input).toBe(QUESTION);
    expect(requests()).toEqual([]);
    expect(toastError).toHaveBeenCalledWith(
      "Attached files are not ready yet.",
    );
  });

  it("asks for unreadable files to be removed and keeps the message", async () => {
    hold = "blocked";
    await pressEnter();

    expect(textarea().value).toBe(QUESTION);
    expect(requests()).toEqual([]);
    expect(toastError).toHaveBeenCalledWith(
      "Remove unreadable files before sending.",
    );
  });

  it("reports a held Voice Mode turn as not accepted", async () => {
    hold = "waiting";
    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await session().handleSubmitText({
        text: "Read me the summary",
        inputMode: "voice",
        submitReason: "semantic_end_turn",
      });
    });

    expect(accepted).toBe(false);
    expect(session().input).toBe(QUESTION);
    expect(requests()).toEqual([]);
    expect(toastError).toHaveBeenCalledWith(
      "Attached files are not ready yet.",
    );
  });

  it("sends once the attachments are readable", async () => {
    hold = "waiting";
    await pressEnter();
    expect(requests()).toEqual([]);

    hold = "none";
    await pressEnter();

    expect(session().input).toBe("");
    expect(requests()).toEqual(["POST /v1/chats"]);
  });

  it("sends only the attachments that were readable when the turn was accepted", async () => {
    attached = ["file-ready"];
    await pressEnter();
    expect(requests()).toEqual(["POST /v1/chats"]);

    // A file added while the chat is being created is not readable yet.
    attached = ["file-ready", "file-new"];
    hold = "waiting";
    await act(async () => {
      recorded[0].respond(
        Response.json({ id: "chat-new", anima_id: "anima-1", title: null }),
      );
    });
    const turn = await settleUntil(() =>
      recorded.find(({ path }) => path.endsWith("/chat:sse")),
    );

    expect(turn.body).toMatchObject({ attached_file_ids: ["file-ready"] });
  });
});
