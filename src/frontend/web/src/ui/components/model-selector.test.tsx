import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ModelSelectorLogo } from "./model-selector";

it("renders accessible provider initials without requesting remote logo bytes", () => {
  const html = renderToStaticMarkup(<ModelSelectorLogo provider="openai" />);
  expect(html).toContain('aria-label="openai provider"');
  expect(html).toContain(">O</span>");
  expect(html).not.toMatch(/<img|https?:|src=/);
  expect(renderToStaticMarkup(<ModelSelectorLogo provider="" />)).toContain(
    ">?</span>",
  );
});
