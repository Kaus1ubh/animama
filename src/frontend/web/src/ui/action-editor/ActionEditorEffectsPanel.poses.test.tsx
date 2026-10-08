// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PyPose } from "@animama/runtime-contracts/api-types";
import { ActionEditorEffectsPanel } from "./ActionEditorEffectsPanel";

vi.mock("@/ui/sound-upload/SoundUploadButton", () => ({
  SoundUploadButton: () => <button>Upload</button>,
}));

const localPose: PyPose = {
  item_id: "friendly-wave",
  name: "Friendly Wave",
  kind: "pose",
  source: "local",
  pose_id: "wave",
  revision_sha256: "rev",
  editable: true,
};
const includedPose: PyPose = {
  ...localPose,
  item_id: "meme-dab",
  name: "Meme Dab",
  source: "included",
  pose_id: "meme-dab",
  editable: false,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderPanel(poses: PyPose[]) {
  act(() =>
    root.render(
      <ActionEditorEffectsPanel
        query=""
        onQueryChange={() => undefined}
        activeType="particle_effect"
        onActiveTypeChange={() => undefined}
        sections={[]}
        dependencies={[]}
        onAdd={() => undefined}
        poses={poses}
        onAddPose={() => undefined}
        onEditPose={() => undefined}
        onCreatePose={() => undefined}
      />,
    ),
  );
}

const showIncluded = () =>
  container.querySelector<HTMLButtonElement>('[role="checkbox"]')!;

describe("ActionEditorEffectsPanel Poses tab", () => {
  it("lists Included Poses only after Show Included is checked", () => {
    renderPanel([localPose, includedPose]);
    expect(showIncluded().getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).toContain("Friendly Wave");
    expect(container.textContent).not.toContain("Meme Dab");

    act(() => showIncluded().click());
    expect(showIncluded().getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain("Meme Dab");

    act(() => showIncluded().click());
    expect(container.textContent).not.toContain("Meme Dab");
  });

  it("points to Show Included when only Included Poses exist", () => {
    renderPanel([includedPose]);
    expect(container.textContent).toContain("No saved poses yet");
    expect(container.textContent).toContain("or show Included Poses.");
  });
});
