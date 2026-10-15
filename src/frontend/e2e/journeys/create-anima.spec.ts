import { randomUUID } from "node:crypto";
import type { Locator, Page, Request, Route } from "playwright/test";
import type { CreateAnimaRequest } from "@animama/runtime-contracts/api-types";
import { expect, test } from "../fixtures/animama";

const apiPath = (url: string) =>
  decodeURIComponent(new URL(url).pathname.replace(/\/$/, ""));

type ReviewTransitionRequests = {
  evidence: number;
  validation: number;
  previews: number;
};

/** Count review-transition requests independently of page timing. */
function observeReviewTransition(page: Page) {
  const counts: ReviewTransitionRequests = {
    evidence: 0,
    validation: 0,
    previews: 0,
  };
  const listener = (request: Request) => {
    if (request.method() !== "POST") return;
    const path = apiPath(request.url());
    if (path === "/v1/content/evidence:resolve") counts.evidence += 1;
    else if (path === "/v1/animas:validate") counts.validation += 1;
    else if (
      path === "/v1/content/previews:prepare" ||
      path.endsWith(":preview")
    )
      counts.previews += 1;
  };
  page.on("request", listener);
  return {
    counts,
    stop: () => page.off("request", listener),
  };
}

/** Every ordinary case intercepts creation before delivery; only the opt-in case writes. */
async function creationTransport(
  page: Page,
  respond?: (
    route: Route,
    command: CreateAnimaRequest,
    attempt: number,
  ) => Promise<void>,
) {
  const commands: CreateAnimaRequest[] = [];
  await page.route(
    (url) =>
      ["/v1/animas", "/v1/animas/bulk"].includes(
        url.pathname.replace(/\/$/, ""),
      ),
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const command = route.request().postDataJSON() as CreateAnimaRequest;
      commands.push(command);
      if (respond) await respond(route, command, commands.length);
      else await route.abort("blockedbyclient");
    },
  );
  return commands;
}

async function openCreator(page: Page) {
  await page.goto("/animas/new");
  await expect(
    page.getByRole("heading", { name: "Choose an Avatar", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Creator hub", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveCount(1);
  await expect(page.getByText("0 / 40", { exact: false })).toBeVisible();
  // The source list is the readiness signal. Network-idle is deliberately not
  // used because the selected Avatar's protected bytes can still be loading.
}

async function chooseIncludedAvatar(page: Page) {
  const choice = page.getByRole("radio", {
    name: "Avatarchibi 2 Included",
    exact: true,
  });
  await expect(choice).toBeVisible();
  // The visual card label intentionally covers the sr-only radio. Dispatch to
  // the radio itself, then wait for the asynchronous exact-source resolution.
  await choice.click({ force: true });
  await expect(choice).toBeChecked();
  await expect(page.getByText("Avatar portrait", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByTestId("create-anima-canvas").locator("canvas"),
  ).toHaveCount(1);
  await expect(page.getByText("Preview ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
}

async function identity(page: Page, name = "E2E Rowan") {
  await page
    .getByRole("button", { name: "Continue to Identity", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Define their Identity", exact: true }),
  ).toBeFocused();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  const editor = page.getByRole("textbox", {
    name: "Identity Markdown",
    exact: true,
  });
  await expect(editor).toContainText("# [NAME]");
  await expect(editor).toContainText("## Personality");
  await expect(editor).toContainText("## Speaking style");
  await expect(editor).toContainText("## Boundaries");
  await editor.fill("# Rowan\n\nA curious and patient companion.\n");
}

async function continueToReviewWithConstantRequests(page: Page) {
  const transition = observeReviewTransition(page);
  try {
    await page
      .getByRole("button", { name: "Continue to Review", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Review Anima", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create Anima", exact: true }),
    ).toBeEnabled();
    expect(transition.counts).toEqual({
      evidence: 1,
      validation: 1,
      previews: 0,
    });
    return transition.counts;
  } finally {
    transition.stop();
  }
}

/**
 * The wizard's emotion rows. Each row's name also carries its Reaction count,
 * so rows are found by the levels region they control.
 */
function reactionEmotionRows(matrix: Locator) {
  return matrix.locator(
    'button[aria-controls^="creation-reaction-"][aria-controls$="-levels"]',
  );
}

function reactionEmotionRow(matrix: Locator, emotion: string) {
  return matrix.locator(
    `button[aria-controls="creation-reaction-${emotion}-levels"]`,
  );
}

/** The Add picker of each of Admiration's intensity cells. */
function admirationAddButtons(matrix: Locator) {
  return matrix
    .getByRole("region", { name: "Admiration Reaction levels", exact: true })
    .getByRole("button", { name: /^Add a Reaction to Admiration · / });
}

async function reviewEmptyActions(page: Page) {
  await page
    .getByRole("button", { name: "Continue to Actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear all Gestures", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Clear selections", exact: true })
    .click();
  await page.getByRole("tab", { name: /^Reactions/ }).click();
  const matrix = page.getByTestId("creation-reaction-matrix");
  await expect(reactionEmotionRows(matrix)).toHaveCount(24);
  await expect(reactionEmotionRow(matrix, "admiration")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  // Admiration's four intensity cells each have an Add picker.
  await expect(admirationAddButtons(matrix)).toHaveCount(4);
  await page
    .getByRole("button", { name: "Clear all Reactions", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Clear selections", exact: true })
    .click();
  await expect(
    page.getByText("All 96 cells are empty. Your Anima can still be created.", {
      exact: true,
    }),
  ).toBeVisible();
  await continueToReviewWithConstantRequests(page);
}

function expectStrictCommand(command: CreateAnimaRequest) {
  expect(Object.keys(command).sort()).toEqual([
    "appearance",
    "avatar",
    "display_name",
    "expected_source_revisions",
    "gestures",
    "idempotency_key",
    "identity_markdown",
    "reactions",
    "schema_version",
    "starter_pack",
  ]);
  expect(command.idempotency_key).toMatch(
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
  );
  expect(Object.keys(command.avatar).sort()).toEqual([
    "item_id",
    "revision_sha256",
  ]);
  // Every one of the 96 cells is sent as a pool, here all empty.
  const pools = Object.values(command.reactions).flatMap((cells) =>
    Object.values(cells),
  );
  expect(pools).toHaveLength(96);
  expect(pools.every((pool) => Array.isArray(pool) && !pool.length)).toBe(true);
  expect(command.gestures).toEqual([]);
  expect(command.appearance).toEqual({ profile: null, background: null });
  // The server seeds the Idle pool, so the command pins no Idle source.
  expect(
    Object.values(command.expected_source_revisions).map(
      (value) => (value as { kind?: string }).kind,
    ),
  ).not.toContain("idle_style");
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 800 },
  { width: 375, height: 812 },
]) {
  test(`four steps and draft recovery at ${viewport.width}px @create-anima @read-only`, async ({
    page,
    animamaEvidence,
  }) => {
    await page.setViewportSize(viewport);
    const commands = await creationTransport(page);
    await openCreator(page);
    // The placeholder and empty-roster entry require no existing runtime or canvas.
    await expect(page.locator("canvas")).toHaveCount(0);
    await chooseIncludedAvatar(page);
    await identity(page);
    await expect(
      page.getByRole("button", { name: "Values", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Bold", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: "Preview", exact: true }).click();
    await expect(
      page
        .getByRole("tabpanel", { name: "Preview", exact: true })
        .locator("img"),
    ).toHaveCount(0);
    await reviewEmptyActions(page);
    await page.reload();
    await page
      .getByRole("button", { name: "Resume saved draft", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Review Anima", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create Anima", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Recheck sources", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Create Anima", exact: true }),
    ).toBeEnabled();
    await expect(page.locator("canvas")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await animamaEvidence.attachBuffer(
      `creation-review-${viewport.width}`,
      await page.screenshot(),
      "image/png",
    );
    expect(commands).toHaveLength(0);
  });
}

test("missing and overlong global names are clear without staling a workflow step @create-anima @read-only", async ({
  page,
  animamaEvidence,
}) => {
  const commands = await creationTransport(page);
  await openCreator(page);
  await chooseIncludedAvatar(page);
  await page
    .getByRole("button", { name: "Continue to Identity", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continue to Actions", exact: true })
    .click();
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  const missingIssue = page.getByRole("button", {
    name: "Enter a name to continue.",
    exact: true,
  });
  await expect(missingIssue).toBeVisible();
  await expect(page.locator("#creation-name-error")).toHaveText(
    "Enter a name to continue.",
  );
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await animamaEvidence.attachBuffer(
    "creation-name-required-phase8-followup",
    await page.screenshot(),
    "image/png",
  );
  await missingIssue.click();
  await expect(name).toBeFocused();
  await name.fill("N".repeat(41));
  await expect(missingIssue).toHaveCount(0);
  const nameIssue = page.getByRole("button", {
    name: "Use 1–40 characters without control characters.",
    exact: true,
  });
  await expect(nameIssue).toBeVisible();
  await expect(page.locator("#creation-name-error")).toHaveText(
    "Use 1–40 characters without control characters.",
  );
  await expect(page.getByText("Needs attention", { exact: true })).toHaveCount(
    0,
  );
  await nameIssue.click();
  await expect(name).toBeFocused();
  await name.fill("Name fixed");
  await expect(nameIssue).toHaveCount(0);
  await page
    .getByRole("button", { name: "Continue to Actions", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Choose Actions", exact: true }),
  ).toBeVisible();
  expect(commands).toHaveLength(0);
});

test("default Actions-to-Review uses one evidence request and no previews @create-anima @read-only", async ({
  page,
  animamaEvidence,
}) => {
  const commands = await creationTransport(page);
  await openCreator(page);
  await chooseIncludedAvatar(page);
  await identity(page, "E2E Phase Seven");
  await page
    .getByRole("button", { name: "Continue to Actions", exact: true })
    .click();
  // Every one of the 96 cells starts with its Included Reactions.
  await expect(
    page.getByText(
      /Version 1 · \d+ recommended Gestures · 96 recommended cells/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Selected", exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Selected: None", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("Equipped", { exact: true })).toHaveCount(0);
  await animamaEvidence.attachBuffer(
    "creation-actions-phase8",
    await page.screenshot(),
    "image/png",
  );
  await page.getByRole("tab", { name: /^Reactions/ }).click();
  const matrix = page.getByTestId("creation-reaction-matrix");
  await expect(reactionEmotionRows(matrix)).toHaveCount(24);
  await expect(reactionEmotionRow(matrix, "admiration")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(reactionEmotionRow(matrix, "caring")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  // Four intensity cells, each starting from its recommended pool: the one
  // Included Reaction at Mild and both Included Reactions above it.
  await expect(admirationAddButtons(matrix)).toHaveCount(4);
  for (const [intensity, starters] of [
    ["Mild", 1],
    ["Moderate", 2],
    ["Strong", 2],
    ["Intense", 2],
  ] as const)
    await expect(
      matrix
        .getByRole("list", { name: `Admiration · ${intensity}`, exact: true })
        .getByLabel("Starter", { exact: true }),
    ).toHaveCount(starters);
  await expect(
    page.getByRole("tab", { name: "Reactions (96/96)", exact: true }),
  ).toBeVisible();
  await animamaEvidence.attachBuffer(
    "creation-reactions-phase8-followup",
    await page.screenshot(),
    "image/png",
  );
  const counts = await continueToReviewWithConstantRequests(page);
  await expect(
    page.getByText("168 Reactions across all cells", { exact: true }),
  ).toBeVisible();
  expect(commands).toHaveLength(0);
  await animamaEvidence.attachJson("creation-phase7-request-counts", counts);
});

test("known rejection reuses a key until a semantic edit @create-anima @read-only", async ({
  page,
  animamaEvidence,
}) => {
  const commands = await creationTransport(page, async (route) => {
    await route.fulfill({
      status: 503,
      json: {
        detail: {
          code: "anima_creation_defaults_unavailable",
          message: "Fixture: model temporarily unavailable.",
          retryable: true,
          issues: [],
        },
      },
    });
  });
  await openCreator(page);
  await chooseIncludedAvatar(page);
  await identity(page);
  await reviewEmptyActions(page);
  await page.getByRole("button", { name: "Create Anima", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Recheck sources", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Recheck sources", exact: true })
    .click();
  await page.getByRole("button", { name: "Create Anima", exact: true }).click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1]).toEqual(commands[0]);
  await page
    .getByRole("button", { name: "Edit Identity", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("A changed live name");
  await page
    .getByRole("button", { name: "Continue to Review", exact: true })
    .click();
  await page.getByRole("button", { name: "Create Anima", exact: true }).click();
  await expect.poll(() => commands.length).toBe(3);
  expect(commands[2]!.idempotency_key).not.toBe(commands[0]!.idempotency_key);
  commands.forEach(expectStrictCommand);
  await animamaEvidence.attachJson("creation-rejection-proof", {
    attempts: commands.length,
    unchangedRetry:
      commands[0]!.idempotency_key === commands[1]!.idempotency_key,
    editedKeyRotated: true,
    deliveredToBackend: false,
  });
});

test("uncertain recovery precedes mutable reads and deleted results require acknowledgement @create-anima @read-only", async ({
  page,
  animamaEvidence,
}) => {
  const commands = await creationTransport(
    page,
    async (route, _command, attempt) => {
      if (attempt === 1) await route.abort("failed");
      else
        await route.fulfill({
          status: 410,
          json: {
            detail: {
              code: "creation_result_deleted",
              message: "Fixture: original result was deleted.",
              retryable: false,
              issues: [],
            },
          },
        });
    },
  );
  await openCreator(page);
  await chooseIncludedAvatar(page);
  await identity(page);
  await reviewEmptyActions(page);
  await page
    .getByRole("button", { name: "Create Anima", exact: true })
    .dblclick();
  await expect(
    page.getByRole("button", { name: "Check creation result", exact: true }),
  ).toBeEnabled();
  expect(commands).toHaveLength(1);
  const mutableReads: string[] = [];
  await page.route(
    (url) =>
      [
        "/v1/animas/creation-options",
        "/v1/avatar-content",
        "/v1/appearance-content",
        "/v1/gestures",
        "/v1/reactions",
      ].includes(url.pathname),
    async (route) => {
      mutableReads.push(apiPath(route.request().url()));
      await route.fulfill({
        status: 503,
        json: { detail: "Fixture: mutable sources unavailable" },
      });
    },
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Check creation result", exact: true }),
  ).toBeVisible();
  expect(commands).toHaveLength(1);
  expect(mutableReads).toEqual([]);
  await expect(page.locator("canvas, textarea, input[type=file]")).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Check creation result", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "This Anima was deleted", exact: true }),
  ).toBeVisible();
  expect(commands[1]).toEqual(commands[0]);
  expect(mutableReads).toEqual([]);
  await expect(
    page.getByRole("button", {
      name: "Acknowledge and start over",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create Anima", exact: true }),
  ).toHaveCount(0);
  await animamaEvidence.attachJson("creation-uncertain-proof", {
    attempts: commands.length,
    unchangedReplay: true,
    mutableReads,
    deliveredToBackend: false,
  });
});

test("empty-roster fallback and 320px keyboard-safe errors @create-anima @read-only", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 812 });
  const commands = await creationTransport(page);
  await page.route(
    (url) => url.pathname.replace(/\/$/, "") === "/v1/animas",
    async (route) => {
      if (route.request().method() === "GET") await route.fulfill({ json: [] });
      else await route.fallback();
    },
  );
  await page.goto("/animas");
  await expect(
    page.getByRole("heading", { name: "Choose an Avatar", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Continue to Identity", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "A few things need attention" }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Cancel", exact: true })
    .press("Enter");
  await expect(page).toHaveURL(/\/create$/);
  expect(commands).toHaveLength(0);
});

test("hub, sidebar, carousel, and Library retain creation entry points @create-anima @read-only", async ({
  page,
}) => {
  const commands = await creationTransport(page);
  const heading = page.getByRole("heading", {
    name: "Choose an Avatar",
    exact: true,
  });
  await page.goto("/create");
  await expect(
    page.getByRole("link", { name: "Create Gesture", exact: true }),
  ).toHaveAttribute("href", "/gestures/new");
  await expect(
    page.getByRole("link", { name: "Create Reaction", exact: true }),
  ).toHaveAttribute("href", "/reactions/new");
  await page.getByRole("link", { name: "Create Anima", exact: true }).click();
  await expect(heading).toBeVisible();

  await page.getByRole("link", { name: "Create", exact: true }).focus();
  await page.getByRole("menuitem", { name: "Anima", exact: true }).click();
  await expect(heading).toBeVisible();
  await page.getByRole("link", { name: "Animas", exact: true }).click();
  await page.getByRole("button", { name: "Create Anima", exact: true }).click();
  await expect(heading).toBeVisible();

  await page.goto("/library");
  await page
    .getByRole("navigation", { name: "Library sections" })
    .getByRole("button", { name: "Avatars", exact: true })
    .click();
  const useAvatar = page
    .getByRole("link", { name: "Create Anima", exact: true })
    .first();
  const href = await useAvatar.getAttribute("href");
  if (!href)
    throw new Error("Library Create Anima must expose its destination.");
  const target = new URL(href, page.url());
  expect(target.pathname).toBe("/animas/new");
  expect(target.searchParams.get("avatar")).toBeTruthy();
  await useAvatar.click();
  await expect(heading).toBeVisible();
  expect(new URL(page.url()).searchParams.get("avatar")).toBe(
    target.searchParams.get("avatar"),
  );
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(1);
  expect(commands).toHaveLength(0);
});

// These cases type credentials: derive a separate top-level fixture whose
// worker-scoped recording options are disabled before its contexts are made.
const signedOutTest = test.extend({
  storageState: { cookies: [], origins: [] },
  trace: "off",
  screenshot: "off",
  video: "off",
});

signedOutTest.describe("signed-out creation handoffs", () => {
  for (const source of ["/animas/new", "/create"]) {
    signedOutTest(
      `${source} restores an unavailable Avatar handoff after sign-in @create-anima @read-only`,
      async ({ page }) => {
        const pageErrors: string[] = [];
        const consoleErrors: string[] = [];
        const failedRequests: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(String(error)));
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("requestfailed", (request) =>
          failedRequests.push(
            `${request.method()} ${apiPath(request.url())}: ${request.failure()?.errorText ?? "unknown failure"}`,
          ),
        );
        const commands = await creationTransport(page);
        const email = process.env.ANIMAMA_E2E_EMAIL;
        const password = process.env.ANIMAMA_E2E_PASSWORD;
        if (!email || !password)
          throw new Error("The runner must provide local sign-in credentials.");
        const missingAvatar = "missing-phase6-avatar";
        await page.goto(`${source}?avatar=${missingAvatar}`);
        await expect(
          page.getByRole("heading", { name: "Sign in to your account" }),
        ).toBeVisible();
        const emailInput = page.getByLabel("Email", { exact: true });
        const passwordInput = page.getByLabel("Password", { exact: true });
        try {
          await emailInput.fill(email);
          await passwordInput.fill(password);
          await page.getByRole("button", { name: /^Sign In$/i }).click();
          await expect(page).toHaveURL(/\/animas\/new/, {
            timeout: 10000,
          });
          await expect(
            page.getByRole("heading", {
              name: "Choose an Avatar",
              exact: true,
            }),
          ).toBeVisible();
        } catch (error) {
          const pageState = (await page.locator("body").innerText()).slice(
            0,
            1200,
          );
          await emailInput.fill("").catch(() => {});
          await passwordInput.fill("").catch(() => {});
          throw new Error(
            `Sign-in reached ${page.url()} but did not restore the creator. Visible text: ${pageState}. Page errors: ${pageErrors.join(" | ")}. Console errors: ${consoleErrors.join(" | ")}. Failed requests: ${failedRequests.join(" | ")}`,
            { cause: error },
          );
        }
        expect(new URL(page.url()).pathname).toBe("/animas/new");
        expect(new URL(page.url()).searchParams.get("avatar")).toBe(
          missingAvatar,
        );
        await expect(
          page.getByText(/The Library Avatar could not be selected:/),
        ).toBeVisible();
        await expect(
          page.getByRole("tab", { name: "Included", exact: true }),
        ).toBeEnabled();
        expect(commands).toHaveLength(0);
      },
    );
  }
});

test("real creation and lost-success replay on an explicitly isolated stack @create-anima @writes-anima", async ({
  page,
  animamaEvidence,
}) => {
  test.skip(
    process.env.ANIMAMA_E2E_CREATE_ANIMA_WRITES !== "1",
    "Set ANIMAMA_E2E_CREATE_ANIMA_WRITES=1 only for an isolated verification stack.",
  );
  const project = process.env.ANIMAMA_E2E_COMPOSE_PROJECT ?? "";
  const host = new URL(process.env.ANIMAMA_E2E_API_URL!).hostname;
  expect(project).toMatch(/^animama-create-/);
  expect(
    host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost"),
  ).toBe(true);
  test.setTimeout(180000);
  let createdId: string | null = null;
  const unexpectedPosts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/v1\/(chats|animas\/[^/]+\/chat:sse)/.test(apiPath(request.url()))
    )
      unexpectedPosts.push(apiPath(request.url()));
  });
  const commands = await creationTransport(
    page,
    async (route, _command, attempt) => {
      if (attempt === 1) {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        createdId = (await response.json()).anima_id;
        await route.abort("failed");
      } else await route.fallback();
    },
  );
  await openCreator(page);
  await chooseIncludedAvatar(page);
  await identity(page, `E2E Rowan ${randomUUID().slice(0, 8)}`);
  await reviewEmptyActions(page);
  await page.getByRole("button", { name: "Create Anima", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Check creation result", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page
    .getByRole("button", { name: "Check creation result", exact: true })
    .click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 60000 })
    .toBe(`/${createdId}`);
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  expect(unexpectedPosts).toEqual([]);
  await expect(page.getByTestId("create-anima-stage")).toHaveCount(0);
  // Keep this newly created test companion as inspectable evidence; never delete existing companions.
  await animamaEvidence.attachJson("created-anima", {
    animaId: createdId,
    project,
    attempts: commands.length,
    sameFrozenRequest: true,
    unexpectedPosts,
    cleanup: "Retained only in the explicitly isolated verification stack.",
  });
});
