import { SparklesIcon } from "lucide-react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CreatorFloatingPanel,
  CreatorField,
  CreatorNumberField,
  CreatorPreviewBar,
  CreatorToggleRow,
  CreatorToolbar,
  CreatorWorkspaceShell,
} from ".";

describe("creator editor primitives", () => {
  it("keeps the Canvas full bleed while sidebar-aware controls use the inset", () => {
    const html = renderToString(
      <CreatorWorkspaceShell
        canvas={<div>Canvas</div>}
        toolbar={<div>Toolbar</div>}
        leftPanel={<div>Setup</div>}
        rightPanel={<div>Inspector</div>}
        canvasControls={<div>Canvas controls</div>}
        previewBar={<div>Preview bar</div>}
      />,
    );

    expect(html).toContain("Canvas");
    expect(html).toContain("Setup");
    expect(html).toContain("Inspector");
    expect(html).toContain("--app-shell-sidebar-inset");
    expect(html).toContain("overflow-y-auto");
  });

  it("bounds creator-owned panel and bottom chrome sizes", () => {
    const html = renderToString(
      <CreatorWorkspaceShell
        canvas={<div>Canvas</div>}
        toolbar={<div>Toolbar</div>}
        leftPanel={<div>Setup</div>}
        rightPanel={<div>Inspector</div>}
        previewBar={<div>Preview</div>}
        leftPanelWidth={999}
        rightPanelWidth={999}
        bottomChromeHeight={1}
      />,
    );

    expect(html).toContain("--creator-left-panel-width:440px");
    expect(html).toContain("--creator-right-panel-width:480px");
    expect(html).toContain("--creator-bottom-chrome-height:72px");
    expect(html.match(/lg:overflow-visible/g)).toHaveLength(2);
  });

  it("matches the opaque panel surface used by action creators", () => {
    const html = renderToString(
      <CreatorFloatingPanel>Inspector</CreatorFloatingPanel>,
    );

    expect(html).toContain("bg-background");
    expect(html).toContain("border-border/65");
    expect(html).toContain("shadow-xl");
    expect(html).toContain("shadow-black/8");
  });

  it("marks a field associated with an actionable save failure", () => {
    const html = renderToString(
      <CreatorField label="Name" invalid>
        <input aria-invalid="true" />
      </CreatorField>,
    );

    expect(html).toContain('data-invalid="true"');
    expect(html).toContain("bg-destructive/5");
    expect(html).toContain("text-destructive");
    expect(html).toContain('aria-invalid="true"');
  });

  it("renders the common creator actions and document status", () => {
    const html = renderToString(
      <CreatorToolbar
        typeLabel="Avatar Effect"
        typeIcon={<SparklesIcon />}
        documentName="Eye sparkle"
        contentHealth={<button type="button">Rescan fixture</button>}
        status={{ label: "Unsaved", tone: "dirty" }}
        onNew={() => undefined}
        onImport={() => undefined}
        onJson={() => undefined}
        onLibrary={() => undefined}
        onSave={() => undefined}
        saveDisabled={false}
        saveBusy={false}
        saveLabel="Save"
      />,
    );

    expect(html).toContain("Avatar Effect");
    expect(html).toContain("Eye sparkle");
    expect(html).toContain("Unsaved");
    expect(html).toContain("Library");
    expect(html).toContain("Save");
    expect(html).toContain("Rescan fixture");
  });

  it("makes a save failure explanation available from the status", () => {
    const html = renderToString(
      <CreatorToolbar
        typeLabel="Scene Effect"
        typeIcon={<SparklesIcon />}
        documentName="Confetti"
        status={{
          label: "Save failed",
          tone: "error",
          tooltip: "The image file is missing.",
        }}
        onNew={() => undefined}
        onImport={() => undefined}
        onJson={() => undefined}
        onLibrary={() => undefined}
        onSave={() => undefined}
        saveDisabled={false}
        saveBusy={false}
        saveLabel="Save"
      />,
    );

    expect(html).toContain("Save failed");
    expect(html).toContain(
      'aria-label="Save failed: The image file is missing."',
    );
  });

  it("provides common axis, toggle, and compact preview rows", () => {
    const html = renderToString(
      <>
        <div className="grid grid-cols-3">
          {(["X", "Y", "Z"] as const).map((axis, index) => (
            <CreatorNumberField
              key={axis}
              label={`Offset ${axis}`}
              value={index}
              step={0.01}
              onChange={() => undefined}
            />
          ))}
        </div>
        <CreatorToggleRow label="Mirror" checked onChecked={() => undefined} />
        <CreatorPreviewBar
          subtitle="Eye sparkle"
          playing={false}
          onPlayingChange={() => undefined}
          onRestart={() => undefined}
          duration={{
            value: 2,
            min: 0.05,
            max: 30,
            step: 0.05,
            onValueChange: () => undefined,
          }}
        />
      </>,
    );

    expect(html).toContain("Offset X");
    expect(html).toContain("Offset Y");
    expect(html).toContain("Offset Z");
    expect(html).toContain("Mirror");
    expect(html).toContain('aria-label="Play preview"');
    expect(html).toContain("Duration");
  });

  it.each(["3 conversation turns", "Sticky · until cleared"])(
    "shows %s without a fabricated duration or playhead",
    (indefiniteLabel) => {
      const html = renderToString(
        <CreatorPreviewBar
          subtitle="Effect"
          playing
          onPlayingChange={() => undefined}
          onRestart={() => undefined}
          duration={{
            value: null,
            indefiniteLabel,
            min: 0.1,
            max: 30,
            step: 0.1,
            onValueChange: () => undefined,
          }}
        />,
      );
      expect(html).toContain(indefiniteLabel);
      expect(html).not.toContain('type="number"');
      expect(html).not.toContain("0.00s");
      expect(html).not.toContain("Current playhead time");
      expect(html).toContain('aria-label="Pause preview"');
    },
  );

  it("labels a saved lifetime ruler without claiming elapsed playback", () => {
    const html = renderToString(
      <CreatorPreviewBar
        subtitle="Effect"
        playing
        onPlayingChange={() => undefined}
        onRestart={() => undefined}
        duration={{
          value: 2,
          label: "Run-end buffer",
          min: 0.05,
          max: 30,
          step: 0.05,
          onValueChange: () => undefined,
        }}
      />,
    );
    expect(html).toContain('aria-label="Run-end buffer in seconds"');
    expect(html).toContain("2.00s");
    expect(html).not.toContain("Current playhead time");
  });

  it("accepts a creator-owned preview timeline without changing its content", () => {
    const html = renderToString(
      <CreatorPreviewBar>
        <div>Emitter lane</div>
      </CreatorPreviewBar>,
    );

    expect(html).toContain("Emitter lane");
    expect(html).not.toContain("Duration");
  });
});
