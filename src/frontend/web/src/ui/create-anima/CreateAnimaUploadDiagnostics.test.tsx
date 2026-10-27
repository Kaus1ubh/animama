// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";
import type { AvatarLiveDiagnostics } from "@/lib/avatar/diagnostics/avatarDiagnostics";
import type { AvatarIssue } from "@/lib/avatar/diagnostics/issues";
import type { CreationStageAvatar } from "./CreateAnimaStage";
import { CreateAnimaUploadDiagnostics } from "./CreateAnimaUploadDiagnostics";

const mocks = vi.hoisted(() => ({
  dialogs: [] as Array<{ source: unknown; open: boolean }>,
  // One client, as the real provider keeps it.
  apiClient: {},
  none: { data: undefined },
  load: {
    springMode: "automatic",
    springModeRef: { current: "automatic" },
    materialMode: "automatic",
  },
}));

vi.mock("@animama/product-ui", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useProductApiClient: () => mocks.apiClient,
}));
vi.mock("@/query/hooks/useAnimaRuntimeCatalog", () => ({
  useAnimaRuntimeCatalog: () => ({ data: undefined, isPending: false }),
}));
vi.mock("@/query/hooks/useAnimaLoadout", () => ({
  useAnimaLoadout: () => ({ data: undefined }),
}));
vi.mock("@/query/hooks/useAvatarSettings", () => ({
  useAvatarSettings: () => mocks.none,
  useAvatarLoadSettings: () => mocks.load,
}));
vi.mock("@/ui/animas/AvatarDiagnosticsDialog", () => ({
  AvatarDiagnosticsDialog: (props: { source: unknown; open: boolean }) => {
    mocks.dialogs.push({ source: props.source, open: props.open });
    return null;
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A GLB holding only `json`. */
function glbFile(json: unknown): File {
  const text = JSON.stringify(json);
  const chunk = new TextEncoder().encode(
    text.padEnd(Math.ceil(text.length / 4) * 4, " "),
  );
  const bytes = new Uint8Array(20 + chunk.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, chunk.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(chunk, 20);
  return new File([bytes], "upload.vrm");
}

/** The stage's Avatar, as far as Diagnostics reads it. */
function stageAvatar(issues: AvatarIssue[]): Avatar {
  return {
    vrm: {},
    getDiagnostics: () => ({ issues }) as unknown as AvatarLiveDiagnostics,
    subscribeDiagnostics: () => () => undefined,
  } as unknown as Avatar;
}

const FILE = glbFile({ extensions: { VRMC_vrm: { specVersion: "1.0" } } });
let root: Root | null = null;

function render(stage: CreationStageAvatar) {
  if (!root) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  act(() =>
    root!.render(<CreateAnimaUploadDiagnostics file={FILE} stage={stage} />),
  );
}

async function settle(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

const status = () =>
  document.body.querySelector('[role="status"]')?.textContent ?? "";

beforeEach(() => {
  mocks.dialogs = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Create Anima upload diagnostics", () => {
  it("checks while the stage loads, then counts the problems found", async () => {
    render({ avatar: null, status: "loading" });
    expect(status()).toBe("Checking this Avatar…");

    render({ avatar: stageAvatar([]), status: "ready" });
    await settle(() => status() === "No problems found.");
    expect(status()).toBe("No problems found.");

    render({
      avatar: stageAvatar([
        { code: "face_parts_detection_failed" },
        { code: "springs_metadata_missing" } as AvatarIssue,
        // Left by the stage's own Action previews; not the file's problem.
        {
          code: "effect_attachment_limit",
          params: { effectId: "stage-preview-fx" },
        },
      ]),
      status: "ready",
    });
    await settle(() => status() === "2 problems found.");
    expect(status()).toBe("2 problems found.");
  });

  it("opens Diagnostics for the unsaved upload", async () => {
    const avatar = stageAvatar([]);
    render({ avatar, status: "ready" });
    const view = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "View diagnostics",
    )!;
    act(() => view.click());
    expect(mocks.dialogs.at(-1)).toEqual({
      source: { kind: "upload", file: FILE, avatar, stage: "ready" },
      open: true,
    });
  });

  it("still links a file the stage could not load to its Diagnostics", () => {
    render({ avatar: null, status: "failed" });
    expect(status()).toBe("Animama could not load this Avatar.");
    const view = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "View diagnostics",
    )!;
    act(() => view.click());
    expect(mocks.dialogs.at(-1)).toMatchObject({
      source: { kind: "upload", stage: "failed", avatar: null },
      open: true,
    });
  });
});
