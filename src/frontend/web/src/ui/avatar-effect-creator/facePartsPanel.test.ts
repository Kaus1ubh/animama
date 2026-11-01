import { getI18n } from "react-i18next";
import { describe, expect, it } from "vitest";

import type {
  AvatarFacePartMap,
  AvatarFacePartRole,
} from "@/lib/avatar/vfx/faceParts";
import {
  facePartCorrection,
  facePartDraftProblem,
  facePartRows,
  toggleFacePartBinding,
} from "./facePartsPanel";

function partMap(
  overrides: Partial<
    Record<
      AvatarFacePartRole,
      Partial<AvatarFacePartMap["parts"][AvatarFacePartRole]>
    >
  > = {},
): AvatarFacePartMap {
  const part = (role: AvatarFacePartRole, bindings: string[]) => ({
    role,
    bindings,
    source: "signals" as const,
    confidence: 0.9,
    ...overrides[role],
  });
  return {
    parts: {
      face_skin: part("face_skin", ["91:0:3"]),
      eye_left: part("eye_left", ["91:0:1"]),
      eye_right: part("eye_right", ["91:0:1"]),
      eye_highlight: part("eye_highlight", ["91:0:2"]),
      eyeline: part("eyeline", ["91:0:6"]),
      eyelash: part("eyelash", []),
      hair: part("hair", ["93:2:0"]),
    },
    eyeWhite: [],
    diagnostics: [],
    issues: [],
  };
}

const primitives = [
  { key: "91:0:3", name: "Face" },
  { key: "91:0:1", name: "Eyes" },
  { key: "91:0:4", name: "Mouth" },
];
const SHA = "c".repeat(64);

describe("face parts panel", () => {
  it("reports each part's source, confidence and mesh parts", () => {
    const rows = facePartRows(
      partMap({
        eyeline: { source: "names", confidence: 0.5 },
        eyelash: { source: "missing", confidence: 0 },
        hair: { source: "corrected", confidence: 1 },
      }),
      primitives,
    );
    const byRole = Object.fromEntries(rows.map((row) => [row.role, row]));
    expect(byRole.face_skin).toMatchObject({
      status: "detected",
      statusLabel: "Detected · 90%",
      required: true,
      bindings: [{ key: "91:0:3", name: "Face" }],
    });
    expect(byRole.eyeline).toMatchObject({ status: "uncertain" });
    expect(byRole.eyeline!.statusLabel).toContain("Found by name");
    expect(byRole.eyelash).toMatchObject({
      status: "missing",
      required: false,
    });
    expect(byRole.hair).toMatchObject({ status: "corrected" });
  });

  it("shows an eye placed without geometry of its own as estimated", () => {
    const rows = facePartRows(
      partMap({
        eye_left: {
          bindings: [],
          source: "estimated",
          estimate: "blink",
          confidence: 0.5,
        },
      }),
      primitives,
    );
    expect(rows.find((row) => row.role === "eye_left")).toMatchObject({
      status: "uncertain",
      statusLabel: "Position estimated",
      bindings: [],
    });
  });

  it("marks only the parts the user changed as corrected", () => {
    const detected = partMap();
    const pinned = (role: AvatarFacePartRole, bindings: string[]) => ({
      bindings,
      source: "corrected" as const,
      confidence: 1,
      detected: detected.parts[role],
    });
    // The saved correction pins the required parts as detected and names
    // the eye-line mesh as the eyelashes.
    const rows = facePartRows(
      partMap({
        face_skin: pinned("face_skin", ["91:0:3"]),
        eye_left: pinned("eye_left", ["91:0:1"]),
        eye_right: pinned("eye_right", ["91:0:1"]),
        eyelash: pinned("eyelash", ["91:0:6"]),
      }),
      primitives,
    );
    const byRole = Object.fromEntries(rows.map((row) => [row.role, row]));
    for (const role of ["face_skin", "eye_left", "eye_right"] as const) {
      expect(byRole[role]).toMatchObject({
        status: "detected",
        statusLabel: "Detected · 90%",
      });
    }
    expect(byRole.eyelash).toMatchObject({
      status: "corrected",
      statusLabel: "Corrected",
      bindings: [{ key: "91:0:6" }],
    });
  });

  it("toggles mesh parts and saves a complete correction", () => {
    const map = partMap();
    let draft = toggleFacePartBinding(map, {}, "face_skin", "91:0:4");
    expect(facePartRows(map, primitives, draft)[0]).toMatchObject({
      status: "corrected",
      statusLabel: "Changed, not saved",
    });
    draft = toggleFacePartBinding(map, draft, "eyelash", "91:0:4");
    const correction = facePartCorrection({
      map,
      draft,
      vrmSha256: SHA,
      previous: null,
    });
    expect(correction).toEqual({
      schema: "animama/avatar-face-parts/1",
      vrm_sha256: SHA,
      parts: {
        face_skin: ["91:0:3", "91:0:4"],
        eye_left: ["91:0:1"],
        eye_right: ["91:0:1"],
        // Only edited optional parts are fixed; the rest keep following detection.
        eyelash: ["91:0:4"],
      },
    });
  });

  it("refuses a correction without a required part or a digest", () => {
    const map = partMap();
    const keys = primitives.map((primitive) => primitive.key);
    const draft = toggleFacePartBinding(map, {}, "face_skin", "91:0:3");
    expect(facePartDraftProblem(map, draft, SHA, keys)).toMatch(/face skin/);
    expect(facePartDraftProblem(map, {}, null, keys)).toMatch(/digest/);
    expect(facePartDraftProblem(map, {}, SHA, keys)).toBeNull();
  });

  it("words statuses and problems in the UI Locale", async () => {
    const map = partMap();
    const keys = primitives.map((primitive) => primitive.key);
    const draft = toggleFacePartBinding(map, {}, "face_skin", "91:0:3");
    await getI18n().changeLanguage("ja");
    try {
      expect(facePartRows(map, primitives)[0]).toMatchObject({
        label: "顔の肌",
        statusLabel: "検出・90%",
      });
      expect(facePartDraftProblem(map, draft, SHA, keys)).toBe(
        "顔の肌のメッシュパーツを 1 つ以上選んでください。",
      );
    } finally {
      await getI18n().changeLanguage("en");
    }
  });

  it("refuses mesh parts from another Avatar", () => {
    const map = partMap();
    // A key picked on a different model is not one of this Avatar's parts.
    const draft = toggleFacePartBinding(map, {}, "eyelash", "143:0:6");
    expect(
      facePartDraftProblem(
        map,
        draft,
        SHA,
        primitives.map((primitive) => primitive.key),
      ),
    ).toMatch(/does not have/);
  });
});
