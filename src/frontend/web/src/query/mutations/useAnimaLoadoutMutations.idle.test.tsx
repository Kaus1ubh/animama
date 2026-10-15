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
  options: [] as Options[],
}));

vi.mock("@animama/runtime-contracts/sdk", async (original) => ({
  ...(await original<typeof import("@animama/runtime-contracts/sdk")>()),
  planIdleV1AnimasAnimaIdIdlePlanPost: mocks.plan,
  commitIdleV1AnimasAnimaIdIdleCommitPost: mocks.commit,
}));
vi.mock("@tanstack/react-query", async (original) => {
  const query = await original<typeof import("@tanstack/react-query")>();
  return {
    ...query,
    useMutation: (options: Options) => {
      mocks.options.push(options);
      return query.useMutation(options);
    },
  };
});

/** The Idle change the hook registers, and the query client it invalidates. */
function changeIdle() {
  mocks.options = [];
  const client = new QueryClient();
  function Probe() {
    useAnimaLoadoutMutations("anima-1");
    return null;
  }
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      {withRuntime(<Probe />)}
    </QueryClientProvider>,
  );
  // Only the Idle change refetches on settle; the others refetch on success.
  const options = mocks.options.find((value) => value.onSettled);
  expect(options?.mutationFn).toBeTypeOf("function");
  return { client, options: options! };
}

const add = {
  expected_revision: 3,
  intent: {
    operation: "add",
    source: { type: "catalog", catalog_item_id: "wave", source: "local" },
  },
};

afterEach(() => {
  mocks.plan.mockReset();
  mocks.commit.mockReset();
});

describe("one-step Idle changes", () => {
  it("plans, then commits the planned digest under a fresh idempotency key", async () => {
    const { options } = changeIdle();
    const keys: string[] = [];
    mocks.plan.mockResolvedValue({
      data: { action: "add", plan_digest: "d".repeat(64) },
    });
    mocks.commit.mockImplementation(async ({ body }) => {
      keys.push(body.idempotency_key);
      return { data: { revision: 4, action: "add" } };
    });

    await options.mutationFn!(add, undefined as never);
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
  });

  it("does not commit a rejected plan", async () => {
    const { options } = changeIdle();
    const conflict = new Error("loadout_revision_conflict");
    mocks.plan.mockRejectedValue(conflict);

    await expect(
      options.mutationFn!(
        {
          expected_revision: 3,
          intent: { operation: "remove", binding_id: "member" },
        },
        undefined as never,
      ),
    ).rejects.toBe(conflict);
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("refetches the Loadout and runtime when a change settles, even after a failure", async () => {
    const { client, options } = changeIdle();
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
