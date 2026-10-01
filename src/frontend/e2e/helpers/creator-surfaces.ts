import { expect, type Locator, type Page } from "playwright/test";

import {
  OBSERVATION_SAMPLE_INTERVAL_MS,
  readPlaybackObservation,
  type PlaybackObservation,
  type PlaybackTargetKind,
} from "./playback-observation";
import { selectAnnieFromSidebar } from "./preview-surfaces";

export type CreatorKind =
  | "Gesture"
  | "Reaction"
  | "Particle VFX"
  | "Avatar VFX"
  | "Scene VFX";

type CreatorDefinition = {
  actionName: RegExp;
  canvasTestId: string;
  path: string;
  targetKind: PlaybackTargetKind;
};

const CREATORS: Record<CreatorKind, CreatorDefinition> = {
  Gesture: {
    actionName: /^Create Gesture$/,
    canvasTestId: "action-editor-canvas",
    path: "/gestures/new",
    targetKind: "anima_pose_clip",
  },
  Reaction: {
    actionName: /^Create Reaction$/,
    canvasTestId: "action-editor-canvas",
    path: "/reactions/new",
    targetKind: "anima_pose_clip",
  },
  "Particle VFX": {
    actionName: /^Particle VFX\b.*\bCreate VFX$/,
    canvasTestId: "particle-vfx-creator-canvas",
    path: "/particle-effects/new",
    targetKind: "particle_vfx",
  },
  "Avatar VFX": {
    actionName: /^Avatar VFX\b.*\bCreate Avatar VFX$/,
    canvasTestId: "avatar-effect-creator-canvas",
    path: "/avatar-effects/new",
    targetKind: "avatar_vfx",
  },
  "Scene VFX": {
    actionName: /^Scene VFX\b.*\bCreate Scene VFX$/,
    canvasTestId: "scene-effect-creator-canvas",
    path: "/scene-effects/new",
    targetKind: "scene_vfx",
  },
};

export type CreatorStage = {
  animaId: string | null;
  observation: PlaybackObservation;
  surface: Locator;
};

/**
 * Select Annie, follow visible Create links, and resolve one real creator
 * preview without deep-link navigation or access to editor/controller state.
 */
export async function openCreatorStage(args: {
  creator: CreatorKind;
  page: Page;
  selectAnnie?: boolean;
}): Promise<CreatorStage> {
  const definition = CREATORS[args.creator];
  const animaId =
    args.selectAnnie === false ? null : await selectAnnieFromSidebar(args.page);

  const createLink = args.page.getByRole("link", {
    name: "Create",
    exact: true,
  });
  await expect(createLink).toHaveCount(1);
  await expect(createLink).toBeVisible();
  await createLink.click();
  await expect(args.page).toHaveURL(/\/create(?:[/?#]|$)/);
  await expect(
    args.page.getByRole("heading", { name: "Create", exact: true }),
  ).toBeVisible();

  const creatorLink = args.page.getByRole("link", {
    name: definition.actionName,
  });
  await expect(creatorLink).toHaveCount(1);
  await expect(creatorLink).toBeVisible();
  await creatorLink.click();
  await expect(args.page).toHaveURL(
    new RegExp(`${escapeRegExp(definition.path)}(?:[/?#]|$)`),
  );

  const canvas = args.page.locator(
    `[data-testid="${definition.canvasTestId}"]:visible`,
  );
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const surface = args.page.locator('[data-playback-surface="creator-stage"]');
  await expect(surface).toHaveCount(1);
  await expect(surface).toBeVisible();
  await expect(
    surface.locator("output[data-playback-observation]"),
  ).toHaveCount(1);

  const observation = await waitForCreatorStageReady({
    expectedKind: definition.targetKind,
    surface,
  });
  return { animaId, observation, surface };
}

/** Wait until the selected Annie Avatar and creator lifecycle settle. */
async function waitForCreatorStageReady(args: {
  expectedKind: PlaybackTargetKind;
  surface: Locator;
  timeoutMs?: number;
}): Promise<PlaybackObservation> {
  const deadline = Date.now() + (args.timeoutMs ?? 30_000);
  let last: PlaybackObservation | null = null;
  while (Date.now() <= deadline) {
    last = await readPlaybackObservation(args.surface);
    if (last.surface !== "creator-stage") {
      throw new Error(`Expected creator-stage; received ${last.surface}.`);
    }
    if (last.target.kind !== args.expectedKind) {
      throw new Error(
        `Expected creator target ${args.expectedKind}; received ${last.target.kind}.`,
      );
    }
    if (!last.target.runtimeId.trim()) {
      throw new Error(
        "Creator observation omitted its draft runtime identity.",
      );
    }
    if (last.target.status === "error") {
      throw new Error(
        `Creator target ${last.target.runtimeId} entered error state.`,
      );
    }
    const avatarPending = last.diagnostics.some(
      (diagnostic) =>
        diagnostic.channel === "avatar" &&
        diagnostic.code === "avatar_not_ready",
    );
    if (
      !avatarPending &&
      ["ready", "playing", "stopped"].includes(last.target.status)
    ) {
      return last;
    }
    await args.surface.page().waitForTimeout(OBSERVATION_SAMPLE_INTERVAL_MS);
  }
  throw new Error(
    `Creator stage did not become Avatar-ready within ${args.timeoutMs ?? 30_000}ms; last lifecycle was ${last?.target.status ?? "unobserved"}.`,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
