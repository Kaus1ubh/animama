import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ModelSelectorLogo } from "./model-selector";

it.each(["openai", "google", "xai", "groq", "deepseek", "huggingface"])(
  "renders the bundled %s provider mark without a CDN request",
  (provider) => {
    const html = renderToStaticMarkup(
      <ModelSelectorLogo provider={provider} />,
    );
    expect(html).toContain(`aria-label="${provider} provider"`);
    expect(html).toContain(`src="/provider-logos/${provider}.svg"`);
    expect(html).not.toMatch(/https?:/);
    const svg = readFileSync(
      new URL(
        `../../../public/provider-logos/${provider}.svg`,
        import.meta.url,
      ),
      "utf8",
    );
    expect(svg).toContain("<svg");
    expect(svg).not.toMatch(
      /<script|<foreignObject|\b(?:href|src)=|url\(\s*https?:/i,
    );
  },
);

it("keeps an accessible local fallback for unknown providers", () => {
  const html = renderToStaticMarkup(
    <ModelSelectorLogo provider="new-provider" />,
  );
  expect(html).toContain('aria-label="new-provider provider"');
  expect(html).toContain(">N</span>");
  expect(html).not.toMatch(/<img|https?:|src=/);
  expect(renderToStaticMarkup(<ModelSelectorLogo provider="" />)).toContain(
    ">?</span>",
  );
});
