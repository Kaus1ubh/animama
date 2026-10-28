import "@fontsource-variable/dm-sans";
import "./site-chrome.css";

import { createRoot } from "react-dom/client";

import { SiteHeader, type SitePage } from "./site-header";

/*
 * The header on the pages Animama Cloud publishes beside the landing page.
 * Each page holds the build's prerendered header in `#site-header` (from
 * `site-chrome.json`), so it shows before this runs and without JavaScript.
 * This renders the same component over it to bring the menu, theme toggle and
 * pill highlight to life.
 */
const root = document.getElementById("site-header");
if (root) {
  const current = ["about", "download"].includes(root.dataset.current ?? "")
    ? (root.dataset.current as SitePage)
    : undefined;
  createRoot(root).render(<SiteHeader current={current} />);
}
