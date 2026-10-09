import { renderToStaticMarkup } from "react-dom/server";
import {
  QueryClient,
  QueryClientProvider,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryEntryApiError } from "@/lib/memory-entries/errors";
import { MemoryManagerApiError } from "@/lib/memory-manager/errors";
import { UserProfileApiError } from "@/lib/user-profile/errors";
import { withRuntime } from "@/test/runtime-markup";
import { useAppendMemoryManagerMessage } from "./useAppendMemoryManagerMessage";
import { useCompleteMemoryManagerRun } from "./useCompleteMemoryManagerRun";
import { useCreateEpisodeProcessingMemoryManagerRun } from "./useCreateEpisodeProcessingMemoryManagerRun";
import { useCreateMemoryEntry } from "./useCreateMemoryEntry";
import { useCreateMemoryManagerRun } from "./useCreateMemoryManagerRun";
import { useCreateReflectionMemoryManagerRun } from "./useCreateReflectionMemoryManagerRun";
import { useDecideMemoryManagerApproval } from "./useDecideMemoryManagerApproval";
import { useDeleteMemoryEntry } from "./useDeleteMemoryEntry";
import { useMoveMemoryEntry } from "./useMoveMemoryEntry";
import { usePatchMemoryEntry } from "./usePatchMemoryEntry";
import { useRepairAnimaMemories } from "./useRepairAnimaMemories";
import { useRevertMemoryEntry } from "./useRevertMemoryEntry";
import { useUndoMemoryManagerApproval } from "./useUndoMemoryManagerApproval";
import { useUpdateUserProfile } from "./useUpdateUserProfile";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  options: [] as Array<UseMutationOptions<unknown, Error, unknown>>,
}));

// Every memory/profile write sends its request through the same fixture.
vi.mock("@animama/runtime-contracts/sdk", async (original) => ({
  ...(await original<typeof import("@animama/runtime-contracts/sdk")>()),
  appendMemoryManagerMessageV1MemoryManagerRunsRunIdMessagesPost: mocks.request,
  completeMemoryManagerRunV1MemoryManagerRunsRunIdCompletePost: mocks.request,
  createEpisodeProcessingMemoryManagerRunV1MemoryManagerRunsProcessEpisodesPost:
    mocks.request,
  createMemoryEntryV1MemoryEntriesPost: mocks.request,
  createMemoryManagerRunV1MemoryManagerRunsPost: mocks.request,
  createReflectionMemoryManagerRunV1MemoryManagerRunsReflectPost: mocks.request,
  decideMemoryManagerApprovalV1MemoryManagerApprovalsApprovalIdDecidePost:
    mocks.request,
  deleteMemoryEntryV1MemoryEntriesEntryIdDelete: mocks.request,
  patchMemoryEntryV1MemoryEntriesEntryIdPatch: mocks.request,
  repairAnimaMemoriesV1MemoryAnimaMemoriesAnimaIdRepairPost: mocks.request,
  revertMemoryEntryV1MemoryEntriesEntryIdRevertPost: mocks.request,
  undoMemoryManagerApprovalV1MemoryManagerApprovalsApprovalIdUndoPost:
    mocks.request,
  updateUserProfileV1UsersMeProfilePatch: mocks.request,
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

const entry = { id: "entry", version: 3 };
const writes = [
  [
    "append Memory Manager message",
    useAppendMemoryManagerMessage,
    MemoryManagerApiError,
    { runId: "run", body: {} },
  ],
  [
    "complete Memory Manager run",
    useCompleteMemoryManagerRun,
    MemoryManagerApiError,
    { runId: "run" },
  ],
  [
    "process episodes",
    useCreateEpisodeProcessingMemoryManagerRun,
    MemoryManagerApiError,
    { body: {} },
  ],
  [
    "create memory entry",
    useCreateMemoryEntry,
    MemoryEntryApiError,
    { body: {} },
  ],
  [
    "start Memory Manager run",
    useCreateMemoryManagerRun,
    MemoryManagerApiError,
    undefined,
  ],
  [
    "start Reflection",
    useCreateReflectionMemoryManagerRun,
    MemoryManagerApiError,
    { body: {} },
  ],
  [
    "decide approval",
    useDecideMemoryManagerApproval,
    MemoryManagerApiError,
    { approvalId: "approval", body: {} },
  ],
  [
    "delete memory entry",
    useDeleteMemoryEntry,
    MemoryEntryApiError,
    { entryId: "entry", expectedVersion: 3 },
  ],
  [
    "move memory entry",
    useMoveMemoryEntry,
    MemoryEntryApiError,
    { source: entry, name: "renamed", affectedEntries: [] },
  ],
  [
    "patch memory entry",
    usePatchMemoryEntry,
    MemoryEntryApiError,
    { entryId: "entry", body: {} },
  ],
  [
    "repair Anima memories",
    useRepairAnimaMemories,
    MemoryEntryApiError,
    { animaId: "anima" },
  ],
  [
    "revert memory entry",
    useRevertMemoryEntry,
    MemoryEntryApiError,
    { entryId: "entry", body: {} },
  ],
  [
    "undo approval",
    useUndoMemoryManagerApproval,
    MemoryManagerApiError,
    { approval: { id: "approval" } },
  ],
  [
    "update profile",
    useUpdateUserProfile,
    UserProfileApiError,
    { display_name: "Ray" },
  ],
] as const;

/** The mutation function a hook registers with TanStack Query. */
function mutationFunction(useWrite: () => unknown) {
  mocks.options = [];
  function Probe() {
    useWrite();
    return null;
  }
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      {withRuntime(<Probe />)}
    </QueryClientProvider>,
  );
  const options = mocks.options.at(-1);
  expect(options?.mutationFn).toBeTypeOf("function");
  return options!.mutationFn!;
}

describe("memory and profile writes", () => {
  afterEach(() => {
    mocks.request.mockReset();
  });

  it.each(writes)(
    "%s keeps a reply that never arrived a connection failure",
    async (_label, useWrite, ApiError, args) => {
      // A lost connection or paused runtime scope yields no HTTP response.
      const lost = new TypeError("Failed to fetch");
      mocks.request.mockResolvedValue({ error: lost });
      const failure = mutationFunction(useWrite)(args, {} as never);
      await expect(failure).rejects.toBe(lost);
      await expect(failure).rejects.not.toBeInstanceOf(ApiError);
    },
  );

  it.each(writes)(
    "%s keeps the server's HTTP status for its stable error",
    async (_label, useWrite, ApiError, args) => {
      mocks.request.mockResolvedValue({
        error: { detail: "Changed elsewhere" },
        response: new Response(null, { status: 409 }),
      });
      const failure = mutationFunction(useWrite)(args, {} as never);
      await expect(failure).rejects.toBeInstanceOf(ApiError);
      await expect(failure).rejects.toMatchObject({ status: 409 });
    },
  );
});
