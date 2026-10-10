import { renderToStaticMarkup } from "react-dom/server";
import {
  QueryClient,
  QueryClientProvider,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { describeChatFailure } from "@animama/product-ui/chat";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { withRuntime } from "@/test/runtime-markup";
import { useCreateChat } from "./useCreateChat";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  options: [] as Array<UseMutationOptions<unknown, Error, unknown>>,
}));

vi.mock("@animama/runtime-contracts/sdk", async (original) => ({
  ...(await original<typeof import("@animama/runtime-contracts/sdk")>()),
  createChatV1ChatsPost: mocks.create,
}));
vi.mock("@tanstack/react-query", async (original) => {
  const query = await original<typeof import("@tanstack/react-query")>();
  return {
    ...query,
    useMutation: (options: UseMutationOptions<unknown, Error, unknown>) => {
      mocks.options.push(options);
      return query.useMutation(options);
    },
  };
});

/** Run the create-chat mutation function the hook registers. */
function createChat() {
  function Probe() {
    useCreateChat();
    return null;
  }
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      {withRuntime(<Probe />)}
    </QueryClientProvider>,
  );
  return mocks.options.at(-1)!.mutationFn!(
    { body: { anima_id: "anima", title: null } },
    {} as never,
  );
}

describe("creating a chat", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.options = [];
  });

  it("returns the created chat", async () => {
    mocks.create.mockResolvedValue({
      data: { id: "chat" },
      response: new Response(null, { status: 201 }),
    });
    await expect(createChat()).resolves.toEqual({ id: "chat" });
  });

  it("rejects with the hosted denial body and its Retry-After wait", async () => {
    mocks.create.mockResolvedValue({
      error: { error: "capacity_busy", code: "capacity_busy" },
      response: new Response(null, {
        status: 503,
        headers: { "Retry-After": "45" },
      }),
    });
    const failure = await createChat().catch((error: unknown) => error);
    expect(failure).toEqual({
      error: "capacity_busy",
      code: "capacity_busy",
      retry_after_seconds: 45,
    });
    expect(describeChatFailure(failure, "hello").guidance).toBe(
      "Try again in about 45 seconds.",
    );
  });

  it("keeps the chat limit denial without a wait", async () => {
    const body = { error: "chat_limit_reached", limit: 500 };
    mocks.create.mockResolvedValue({
      error: body,
      response: new Response(null, { status: 409 }),
    });
    await expect(createChat()).rejects.toBe(body);
  });

  it("rejects with the transport error when no response arrives", async () => {
    const lost = new TypeError("Failed to fetch");
    mocks.create.mockResolvedValue({ error: lost });
    await expect(createChat()).rejects.toBe(lost);
  });
});
