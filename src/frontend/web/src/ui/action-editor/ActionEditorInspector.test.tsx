import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KeyframeInspector } from "@/ui/pose-creator/PoseCreatorClipWorkspaceInspector";
import { ActionEditorClipInspector } from "./ActionEditorPrimitives";

describe("ActionEditorClipInspector capabilities", () => {
  it("retains humanoid clip controls for Gestures", () => {
    const html = renderToString(<ActionEditorClipInspector allowHumanoid />);

    expect(html).toContain("Clip base pose");
    expect(html).toContain('aria-label="Start base"');
    expect(html).toContain('aria-label="End base"');
    expect(html).not.toContain("Return to base");
  });

  it("keeps endpoint toggles in the settings section", () => {
    const settings = renderToString(
      <ActionEditorClipInspector section="settings" />,
    );
    const selectedItem = renderToString(
      <ActionEditorClipInspector section="inspector" />,
    );
    expect(settings).toContain('aria-label="Start base"');
    expect(settings).toContain('aria-label="End base"');
    expect(selectedItem).not.toContain("Start base");
    expect(selectedItem).not.toContain("End base");
  });

  it("removes humanoid clip settings from Reactions", () => {
    const html = renderToString(
      <ActionEditorClipInspector allowHumanoid={false} />,
    );

    expect(html).not.toContain("Return to base");
    expect(html).not.toContain("Clip base pose");
    expect(html).not.toContain("Start base");
    expect(html).not.toContain("End base");
  });
});

describe("KeyframeInspector for a 2.0 beat", () => {
  it("shows the beat label field and its read-only detail note", () => {
    const html = renderToString(
      <KeyframeInspector
        embedded
        keyframe={{
          id: "nod",
          time: 0.5,
          pose: "nod",
          label: "Nod down",
          ease: "linear",
          detail: { channels: 1, before: 0.1, after: 0 },
        }}
        poseAliases={["nod"]}
        allowHumanoid
        disabled={false}
        onClose={() => undefined}
        onUpdate={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="Keyframe label"');
    expect(html).toContain('value="Nod down"');
    expect(html).not.toContain('aria-label="Keyframe pose"');
    expect(html).toContain(
      "Generated detail: moves 1 joint or channel from 0.1 s before to 0 s after this keyframe.",
    );
  });

  it("keeps the pose select for 1.0 keyframes", () => {
    const html = renderToString(
      <KeyframeInspector
        embedded
        keyframe={{ id: "kf_001", time: 0, pose: "wave" }}
        poseAliases={["wave"]}
        allowHumanoid
        disabled={false}
        onClose={() => undefined}
        onUpdate={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="Keyframe pose"');
    expect(html).not.toContain("Generated detail");
  });
});
