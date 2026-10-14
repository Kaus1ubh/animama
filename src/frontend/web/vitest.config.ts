import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const webSrc = fileURLToPath(new URL("./src", import.meta.url));
// The Safety page and dialog bundle the protocol document from the repository.
const safetyDocsRoot = fileURLToPath(
  new URL("../../../docs/safety", import.meta.url),
);
// Included content bundled by the app, such as the Scene sticker PNGs.
const includedContentRoot = fileURLToPath(
  new URL("../../../content/included", import.meta.url),
);

export default defineConfig({
  define: {
    __ANIMAMA_DEV_BUILD__: "true",
    __ANIMAMA_APP_VERSION__: JSON.stringify("test"),
  },
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        safetyDocsRoot,
        includedContentRoot,
      ],
    },
  },
  resolve: {
    alias: {
      "@": webSrc,
      "@web": webSrc,
    },
  },
  test: {
    clearMocks: true,
    environment: "node",
    globals: false,
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "tests/**/*.{test,spec}.{ts,tsx}",
    ],
    restoreMocks: true,
    setupFiles: ["src/test/i18n-setup.ts"],
  },
});
