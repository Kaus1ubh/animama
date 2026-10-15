import { renderToStaticMarkup } from "react-dom/server";
import {
  QueryClient,
  QueryClientProvider,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withRuntime } from "@/test/runtime-markup";
import { useAnimaLoadoutMutations } from "./useAnimaLoadoutMutations";

type Options = UseMutationOptions<unknown, Error, unknown>;

const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  commit: vi.fn(),
}));

vi.mock("@animama/runtime-contracts/sdk", async (original) => ({
  ...(await original<typeof import("@animama/runtime-contracts/sdk")>()),
  planReactionV1AnimasAnimaIdReactionsPlanPost: mocks.plan,
  commitReactionV1AnimasAnimaIdReactionsCommitPost: mocks.commit,
}));
// Each mutation the hook returns exposes the options it was registered with.
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useMutation: (options: Options) => ({ options }),
}));

/** The hook's `changeReaction` options, and the query client it invalidates. */
function changeReaction() {
  const client = new QueryClient();
  let options: Options | undefined;
  function Probe() {
    const mutations = useAnimaLoadoutMutations("anima-1") as unknown as Record<
      string,
      { options: Options }
    >;
    options = mutations.changeReaction?.options;
    return null;
  }
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      {withRuntime(<Probe />)}
    </QueryClientProvider>,
  );
  expect(options?.mutationFn).toBeTypeOf("function");
  return { client, options: options! };
}

const add = {
  expected_revision: 3,
  intent: {
    operation: "add",
    emotion: "joy",
    intensity: 4,
    source: { type: "catalog", catalog_item_id: "cheer", source: "local" },
  },
};

afterEach(() => {
  mocks.plan.mockReset();
  mocks.commit.mockReset();
});

describe("one-step Reaction pool changes", () => {
  it("plans, then commits the planned digest under a fresh idempotency key", async () => {
    const { options } = changeReaction();
    const keys: string[] = [];
    const warning = {
      code: "starter_reaction_unavailable",
      message: "Included Reaction joy-4 is unavailable and was not restored.",
      params: { contentId: "joy-4" },
    };
    mocks.plan.mockResolvedValue({
      data: { action: "add", plan_digest: "d".repeat(64), warnings: [warning] },
    });
    mocks.commit.mockImplementation(async ({ body }) => {
      keys.push(body.idempotency_key);
      return { data: { revision: 4, action: "add" } };
    });

    const result = await options.mutationFn!(add, undefined as never);
    await options.mutationFn!(add, undefined as never);

    expect(mocks.plan.mock.calls[0]![0]).toMatchObject({
      path: { anima_id: "anima-1" },
      body: add,
    });
    expect(mocks.commit.mock.calls[0]![0]).toMatchObject({
      path: { anima_id: "anima-1" },
      body: { ...add, plan_digest: "d".repeat(64) },
    });
    // Each change commits once; a later change never replays an earlier receipt.
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    // The plan's warnings (a starter that could not be restored) reach the caller.
    expect(result).toMatchObject({ revision: 4, warnings: [warning] });
  });

  it("does not commit a rejected plan", async () => {
    const { options } = changeReaction();
    const full = new Error("reaction_pool_full");
    mocks.plan.mockRejectedValue(full);

    await expect(options.mutationFn!(add, undefined as never)).rejects.toBe(
      full,
    );
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("refetches the Loadout and runtime when a change settles, even after a failure", async () => {
    const { client, options } = changeReaction();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await options.onSettled!(
      undefined,
      new Error("loadout_revision_conflict"),
      add,
      undefined,
      undefined as never,
    );

    const refetched = invalidate.mock.calls.map(([filters]) =>
      JSON.stringify(filters?.queryKey),
    );
    expect(refetched.some((key) => key.includes('"anima-runtime"'))).toBe(true);
    expect(refetched.some((key) => key.includes('"anima-loadout"'))).toBe(true);
  });
});
