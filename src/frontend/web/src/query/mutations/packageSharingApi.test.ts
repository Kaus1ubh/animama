import { client as testApiClient } from "@animama/runtime-contracts/default-client";
import { describe, expect, it, vi } from "vitest";
import { createPackageImportApi } from "./packageSharingApi";

const { operation } = vi.hoisted(() => ({ operation: vi.fn() }));
vi.mock("@animama/runtime-contracts/sdk", async (original) => ({
  ...(await original<typeof import("@animama/runtime-contracts/sdk")>()),
  getPackageOperationV1ContentPackageOperationsOperationIdGet: operation,
}));

const packageImportApi = createPackageImportApi(testApiClient);

describe("package transport failures", () => {
  it("reports a safe connection error when the SDK has no HTTP response", async () => {
    operation.mockResolvedValue({ error: new TypeError("Failed to fetch") });
    await expect(packageImportApi.operation("operation")).rejects.toMatchObject(
      {
        code: "package_transport_unavailable",
        message: "Animama could not be reached. Check the local app and retry.",
      },
    );
  });

  it("normalizes rejected transports without exposing their raw details", async () => {
    operation.mockRejectedValue(new Error("private transport detail"));
    await expect(packageImportApi.operation("operation")).rejects.toMatchObject(
      {
        code: "package_transport_unavailable",
      },
    );
  });

  it("keeps server classifications for an admitted HTTP error", async () => {
    operation.mockResolvedValue({
      error: { detail: { code: "package_stage_expired" } },
      response: new Response(null, { status: 410 }),
    });
    await expect(packageImportApi.operation("operation")).rejects.toMatchObject(
      {
        code: "package_stage_expired",
        status: 410,
      },
    );
  });
});
