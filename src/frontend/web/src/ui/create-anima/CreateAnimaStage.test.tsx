import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AvatarPreviewSurfaceProps } from "@/ui/avatar-preview/AvatarPreviewSurface";
import { CreateAnimaStage } from "./CreateAnimaStage";
import { ref } from "./createAnimaTestFixtures";

const mock = vi.hoisted(() => ({
  surface: vi.fn(),
  reducedMotion: vi.fn(() => true),
}));
vi.mock("motion/react", () => ({ useReducedMotion: mock.reducedMotion }));
vi.mock("@/ui/avatar-preview/AvatarPreviewSurface", () => ({
  AvatarPreviewSurface: (props: AvatarPreviewSurfaceProps) => {
    mock.surface(props);
    return <canvas data-testid={props.canvasTestId} />;
  },
}));
vi.mock("./CreateAnimaPreviewSession", () => ({
  CreateAnimaPreviewSession: class {
    stop = vi.fn();
    dispose = vi.fn();
  },
}));

describe("one creator stage", () => {
  it("uses one shared surface with no autoplay, no damping under reduced motion, and no dock", () => {
    const html = renderToStaticMarkup(
      <CreateAnimaStage
        avatar={ref("avatar")}
        file={null}
        loadAvatar={vi.fn()}
        onUpload={vi.fn()}
        suspended={false}
        onFinished={vi.fn()}
      />,
    );
    expect(html.match(/<canvas/g)).toHaveLength(1);
    expect(mock.surface).toHaveBeenCalledWith(
      expect.objectContaining({
        active: false,
        enableDamping: false,
        lifecycleOwner: "creator",
        cameraProfile: "portrait",
      }),
    );
    expect(html).toContain('aria-label="Your Anima preview"');
    expect(html).not.toContain("Preview ready");
    expect(html).not.toContain("Their story starts with you");
    expect(html).not.toMatch(/Reset view|Zoom in|Zoom out|Turn sound/);
    expect(html).not.toContain("floating");
  });
  it("is a useful, non-canvas placeholder before an Avatar is selected", () => {
    const html = renderToStaticMarkup(
      <CreateAnimaStage
        avatar={null}
        file={null}
        loadAvatar={vi.fn()}
        onUpload={vi.fn()}
        suspended={false}
        onFinished={vi.fn()}
      />,
    );
    expect(html).not.toContain("<canvas");
    expect(html).toContain(
      "Upload a VRM (&lt;100 MB) or choose an Avatar to see them here",
    );
    expect(html).not.toContain("A quiet space for your next companion");
    expect(html).toContain('aria-label="Upload a VRM file"');
    expect(html).toMatch(/<button[^>]+aria-label="Upload a VRM file"/);
    expect(html).toContain("lucide-upload");
    expect(html).not.toContain("✧");
  });
});
