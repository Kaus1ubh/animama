import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemoryMarkdownPreview } from "@/ui/memory/MemoryMarkdownPreview";
import { CreateAnimaIdentityStep } from "./CreateAnimaIdentityStep";
import { readyDraft } from "./createAnimaTestFixtures";

vi.mock("@/ui/memory/MemoryCodeEditor", () => ({
  MemoryCodeEditor: ({
    value,
    readOnly,
    ariaLabel,
  }: {
    value: string;
    readOnly: boolean;
    ariaLabel: string;
  }) => (
    <textarea aria-label={ariaLabel} readOnly={readOnly} defaultValue={value} />
  ),
}));

describe("one-document Identity", () => {
  it("offers one plain editor and safe preview without formatting or prompt controls", () => {
    const html = renderToStaticMarkup(
      <CreateAnimaIdentityStep
        draft={readyDraft()}
        suggestion="Optional suggestion"
        errors={[]}
        onChange={vi.fn()}
      />,
    );
    expect(html.match(/<textarea/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Identity Markdown"');
    expect(html).toContain("Write");
    expect(html).toContain("Preview");
    expect(html).toContain("Use Avatar suggestion");
    expect(html).not.toContain("One document. Their own voice.");
    expect(html).not.toContain("Tab moves to the next control");
    expect(html).not.toContain("UTF-8 bytes");
    expect(html).not.toMatch(
      /aria-label="Bold"|aria-label="Italic"|>Heading<|>Personality<|Generate identity/,
    );
  });

  it("locks the editor itself while validating", () => {
    const html = renderToStaticMarkup(
      <CreateAnimaIdentityStep
        draft={readyDraft()}
        suggestion={null}
        errors={[]}
        readOnly
        onChange={vi.fn()}
      />,
    );
    expect(html).toContain('readOnly=""');
  });

  it("renders Markdown without fetching remote images or executing raw HTML", () => {
    const html = renderToStaticMarkup(
      <MemoryMarkdownPreview
        value={
          "# Identity\n\n![external](https://example.test/track.png)\n\n<script>alert(1)</script>"
        }
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('src="https://');
    expect(html).toContain("[Image: external]");
  });
});
