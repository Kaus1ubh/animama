import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Theme } from "./theme";

it("shows theme choices disabled with light selected", () => {
  const html = renderToStaticMarkup(<Theme variant="tabs" showLabel />);
  expect(html.match(/disabled=""/g)).toHaveLength(3);
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain("Light");
  expect(html).toContain("Dark");
  expect(html).toContain("Custom");
});
