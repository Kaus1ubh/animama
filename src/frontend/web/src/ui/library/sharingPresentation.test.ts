import { describe, expect, it } from "vitest";
import { sharingDropSelection } from "./sharingPresentation";

describe("package file drop", () => {
  it("rejects multiple files without silently choosing one", () => {
    const files = [
      new File(["first"], "first.zip"),
      new File(["second"], "second.zip"),
    ];
    expect(sharingDropSelection(files)).toEqual({
      file: null,
      error: "Choose one .zip file at a time",
    });
  });
  it("keeps a single file intact and ignores a drop without files", () => {
    const file = new File(["single"], "one.zip");
    expect(sharingDropSelection([file])).toEqual({ file, error: null });
    expect(sharingDropSelection([])).toEqual({ file: null, error: null });
  });
});
