import { SparklesIcon } from "lucide-react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreatorToolbar } from "./CreatorToolbar";

const props = {
  typeLabel: "Avatar FX",
  typeIcon: <SparklesIcon />,
  documentName: "Eye sparkle",
  onDocumentNameChange: () => undefined,
  status: { label: "Saved", tone: "saved" as const },
  onNew: () => undefined,
  onImport: () => undefined,
  onJson: () => undefined,
  onSave: () => undefined,
  saveDisabled: true,
  saveBusy: false,
  saveLabel: "Save",
};

describe("FX document toolbar", () => {
  it("exposes the inline name and accessible names for icon-only controls", () => {
    const html = renderToString(
      <CreatorToolbar {...props} contentType="avatar_effect" />,
    );
    expect(html).toContain('aria-label="Avatar FX name"');
    expect(html).toContain('value="Eye sparkle"');
    expect(html).toContain('aria-label="Load Avatar FX"');
    expect(html).toContain('aria-label="Import"');
    expect(html).toContain('aria-label="View JSON"');
    expect(html).toContain('aria-label="More creator actions"');
    expect(html).toContain('aria-label="Saved"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Save"/);
  });

  it("retains field validation and actionable failure details", () => {
    const html = renderToString(
      <CreatorToolbar
        {...props}
        documentNameInvalid
        status={{
          label: "Save failed",
          tone: "error",
          tooltip: "Choose a name.",
        }}
      />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-label="Save failed: Choose a name."');
  });
});
