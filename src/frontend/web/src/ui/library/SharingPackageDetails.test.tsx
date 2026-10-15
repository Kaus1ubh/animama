import { renderToStaticMarkup } from "react-dom/server";
import { getI18n } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import type { PortableAnima } from "@animama/runtime-contracts/api-types";

import { SharingAnimaDetails } from "./SharingPackageDetails";
import type { PackageDisplayItem } from "./sharingPresentation";

const items = [
  { id: "cheer", name: "Cheer", kind: "reaction" },
  { id: "grin", name: "Grin", kind: "reaction" },
  { id: "avatar", name: "Mira", kind: "avatar" },
] as PackageDisplayItem[];

function anima(reactions: PortableAnima["reactions"]): PortableAnima {
  return {
    display_name: "Luna",
    identity_markdown: "# Luna",
    avatar: "avatar",
    gestures: [],
    reactions,
    idle: { default: [], cells: {} },
    appearance: { profile: null, background: null },
  } as unknown as PortableAnima;
}

const pools = {
  joy: { "1": [], "2": ["grin", "cheer"], "3": [], "4": ["cheer"] },
  grief: { "1": [], "2": [], "3": [], "4": [] },
} as PortableAnima["reactions"];

/** The Reaction cells disclosure's markup. */
function reactionCells(): string {
  const html = renderToStaticMarkup(
    <SharingAnimaDetails anima={anima(pools)} items={items} />,
  );
  const start = html.lastIndexOf("<details>");
  return html.slice(start, html.indexOf("</details>", start));
}

/** A cell's members, each its own list item, in order. */
function members(label: string, ...names: string[]): RegExp {
  return new RegExp(
    `${label}</dt><dd[^>]*><ol[^>]*>${names
      .map((name) => `<li[^>]*>${name}</li>`)
      .join("")}</ol></dd>`,
  );
}

afterEach(async () => {
  await getI18n().changeLanguage("en");
});

describe("complete Anima package Reaction pools", () => {
  it("lists each cell's pool by name in package order", () => {
    const html = reactionCells();
    // Two of eight cells hold three members in all.
    expect(html).toContain("(2 of 8 cells filled · 3 Reactions)");
    expect(html).toContain(">Joy</h5>");
    expect(html).toContain(">Grief</h5>");
    expect(html).toMatch(members("Moderate", "Grin", "Cheer"));
    expect(html).toMatch(members("Intense", "Cheer"));
    // Empty cells are listed as empty, with each of the four intensity labels.
    expect(html).toMatch(/Mild<\/dt><dd[^>]*>None<\/dd>/);
    expect(html.match(/>Strong<\/dt>/g)).toHaveLength(2);
  });

  it("keeps each name separate in a locale that joins lists without spaces", async () => {
    await getI18n().changeLanguage("zh-Hans");
    const html = reactionCells();
    // Moderate and Intense in Simplified Chinese.
    expect(html).toMatch(members("中等", "Grin", "Cheer"));
    expect(html).toMatch(members("极强", "Cheer"));
    expect(html).not.toContain("GrinCheer");
  });
});
