import { defineConfig } from "@hey-api/openapi-ts";

const localSchemaPath = process.env.ANIMAMA_LOCAL_OPENAPI_PATH;
if (!localSchemaPath) {
  throw new Error(
    "ANIMAMA_LOCAL_OPENAPI_PATH is required; run `pnpm openapi-ts` through the offline exporter.",
  );
}

export default defineConfig([
  {
    input: localSchemaPath,
    output: {
      path: "packages/runtime-contracts/src/generated",
      clean: true,
    },
    // Generated transport has no origin/auth defaults; each composition supplies them.
    plugins: [
      "@hey-api/typescript",
      {
        name: "@hey-api/client-fetch",
        baseUrl: false,
      },
      "zod",
      {
        name: "@hey-api/sdk",
        validator: "zod",
      },
    ],
  },
]);
