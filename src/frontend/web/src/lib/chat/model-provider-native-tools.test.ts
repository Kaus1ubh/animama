import { describe, expect, it } from "vitest";

import type { PyModelProviderCatalogItem } from "@/lib/content/catalogTypes";

import {
  filterRequestableNativeTools,
  requestableNativeTools,
} from "./model-provider-native-tools";

describe("model provider native tools", () => {
  it("keeps complete capabilities separate from requestable tools", () => {
    const item = {
      native_tool_support: ["apply_patch", "web_search"],
      requestable_native_tool_support: ["web_search"],
    } as PyModelProviderCatalogItem;

    expect(requestableNativeTools(item)).toEqual(["web_search"]);
  });

  it("normalizes and filters requested tools against the backend allowlist", () => {
    expect(
      filterRequestableNativeTools(
        [" web_search ", "apply_patch", "web_search"],
        ["web_search"],
      ),
    ).toEqual(["web_search"]);
  });
});
