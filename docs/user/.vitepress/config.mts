import { defineConfig } from "vitepress";

// Only the selected reader pages enter the static publication directory.
export default defineConfig({
  title: "Animama",
  description: "Get started with your local AI avatar companion.",
  lang: "en",
  srcDir: "./pages",
  base: "/",
  cleanUrls: true,
  ignoreDeadLinks: false,
  themeConfig: {
    siteTitle: "Animama Docs",
    nav: [
      { text: "Overview", link: "/" },
      { text: "Desktop", link: "/desktop" },
      { text: "Self-host", link: "/self-host" },
      { text: "Troubleshooting", link: "/troubleshooting" },
    ],
    sidebar: [
      {
        text: "Get started",
        items: [
          { text: "Overview", link: "/" },
          { text: "Desktop getting started", link: "/desktop" },
          { text: "Self-host quick start", link: "/self-host" },
          { text: "Troubleshooting", link: "/troubleshooting" },
        ],
      },
    ],
  },
});
