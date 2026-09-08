import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const webSrc = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  define: { __ANIMAMA_DEV_BUILD__: "true" },
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
  },
});
