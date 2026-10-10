import { client as testApiClient } from "@animama/runtime-contracts/default-client";
import { describe, expect, it, vi } from "vitest";
import type { PyPose } from "@animama/runtime-contracts/api-types";
import {
  parseAnimaPoseClip,
  shouldAnimaPoseClipAutoComplete,
} from "@/lib/avatar/poses/animaPoseClip";
import { createAnimaPoseClipProgram } from "@/lib/avatar/poses/animaPoseClip/program";
import { AnimaRuntimeCatalog } from "@/lib/runtime-content/AnimaRuntimeCatalog";
import { prepareContentPreview } from "./preparation";
import { contentPreviewRequiresAnimaContext } from "./types";
import { resolveLibraryPreviewAnimaContextState } from "./targets";
import {
  posePreviewTarget,
  resolvePosePreviewTarget,
} from "./posePreviewTarget";
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/content/poseContent", () => ({ loadPoseContent: mocks.load }));
const item: PyPose = {
  item_id: "salute",
  pose_id: "builtin:pose:salute",
  name: "Salute",
  source: "included",
  editable: false,
  revision_sha256: "r1",
};
const pose = {
  schema: "animaPose/1.0",
  id: item.pose_id,
  name: item.name,
  humanoid: { head: { rotation: [0, 0, 0, 1] } },
  expressions: { happy: 0.7 },
};

describe("static Pose preview", () => {
  it("holds the checked effective values in an isolated clip without source references", async () => {
    mocks.load.mockResolvedValue({ item, pose });
    const target = await resolvePosePreviewTarget(
      testApiClient,
      posePreviewTarget(item),
    );
    const runtime = prepareContentPreview(target, target.entry).runtime;
    expect(runtime.gestures).toEqual([]);
    expect(runtime.poses).toEqual([target.entry]);
    const catalog = new AnimaRuntimeCatalog(runtime);
    expect(
      await catalog.loadPoseClip(target.runtimeId),
      JSON.stringify(catalog.diagnostics),
    ).not.toBeNull();
    catalog.dispose();
    if (target.entry.source.type !== "authorized_files")
      throw new Error("wrong source");
    const file = target.entry.source.files[0]!;
    const clip = parseAnimaPoseClip(await (await fetch(file.url)).json());
    expect(clip.basePose).toBeUndefined();
    expect(clip.loop).toBe(true);
    const program = createAnimaPoseClipProgram(clip, {
      resolvePose: () => null,
    });
    expect(program.sample(0).sample).toEqual(program.sample(200).sample);
    expect(program.sample(0).sample).toEqual({
      humanoid: pose.humanoid,
      expressions: pose.expressions,
    });
    expect(shouldAnimaPoseClipAutoComplete(clip, 200)).toBe(false);
  });
  it("keeps a standalone Pose playable when an equipped Gesture has the same logical leaf", async () => {
    mocks.load.mockResolvedValue({ item, pose });
    const target = await resolvePosePreviewTarget(
      testApiClient,
      posePreviewTarget(item),
    );
    const runtime = prepareContentPreview(target, target.entry).runtime;
    runtime.gestures = [
      {
        ...target.entry,
        slot: "gesture",
        runtime_id: item.pose_id,
        content_revision: "equipped-other-revision",
      },
    ];
    const catalog = new AnimaRuntimeCatalog(runtime);
    expect(
      await catalog.loadPoseClip(target.runtimeId),
      JSON.stringify(catalog.diagnostics),
    ).not.toBeNull();
    catalog.dispose();
  });
  it("requires an available owned Avatar instead of substituting a model", () => {
    const target = posePreviewTarget(item);
    expect(contentPreviewRequiresAnimaContext(target)).toBe(true);
    expect(
      resolveLibraryPreviewAnimaContextState({
        target,
        active: true,
        settingsLoading: false,
        animasPending: false,
        animasError: false,
        previewAnima: null,
        runtimePending: false,
        runtimeError: false,
        runtimeAvailable: false,
      }),
    ).toBe("anima_required");
  });
  it("rejects stale resolution even when byte loading ignores cancellation", async () => {
    let resolve!: (value: unknown) => void;
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const abort = new AbortController();
    const pending = resolvePosePreviewTarget(
      testApiClient,
      posePreviewTarget(item),
      abort.signal,
    );
    abort.abort();
    resolve({ item, pose });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  it("reports unavailable content without producing a playable target", async () => {
    mocks.load.mockRejectedValueOnce(
      new Error("The Pose descriptor is unavailable."),
    );
    await expect(
      resolvePosePreviewTarget(testApiClient, posePreviewTarget(item)),
    ).rejects.toThrow("unavailable");
  });
});
