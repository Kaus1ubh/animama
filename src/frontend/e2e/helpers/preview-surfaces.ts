import {
  expect,
  type Locator,
  type Page,
  type Response,
} from "playwright/test";

export type LibraryPreviewSection =
  | "gesture"
  | "pose"
  | "reaction"
  | "particle"
  | "avatar"
  | "scene";

export type LibraryPreviewOrigin = "Included" | "Mine";

export type PreparedLibraryPreview = {
  previewButton: Locator;
  surface: Locator;
  open(): Promise<Locator>;
};

function fixturePrecondition(message: string): Error {
  return new Error(`Animama fixture precondition failed: ${message}`);
}

type UserSettingsSnapshot = {
  last_active_anima_id?: unknown;
};

/**
 * Enter the app once, select the unique Annie sidebar link, and wait until the
 * cross-route remembered-Anima setting is durable before leaving her runtime.
 */
export async function selectAnnieFromSidebar(page: Page): Promise<string> {
  let settings: UserSettingsSnapshot = {};
  let settingsKnown = false;
  const current = new URL(page.url());
  // Enter the app first from a blank page or any non-app entry surface.
  if (
    !current.protocol.startsWith("http") ||
    ["/", "/setup", "/safety"].includes(current.pathname)
  ) {
    const settingsResponse = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "GET" &&
        new URL(candidate.url()).pathname === "/v1/users/me/settings" &&
        candidate.ok(),
      { timeout: 15_000 },
    );
    const response = await page.goto("/animas", {
      waitUntil: "domcontentloaded",
    });
    if (!response?.ok()) {
      throw fixturePrecondition(
        `Anima roster navigation failed with HTTP ${response?.status() ?? "unknown"}.`,
      );
    }
    settings = (await (await settingsResponse).json()) as UserSettingsSnapshot;
    settingsKnown = true;
  }

  const sidebarAnimas = page.locator("#sidebar-animas-list");
  await expect(sidebarAnimas).toBeVisible({ timeout: 15_000 });
  const annieLinks = sidebarAnimas
    .getByRole("link")
    .filter({ hasText: /^Annie$/ });
  await expect(annieLinks).toHaveCount(1, { timeout: 15_000 });
  const annie = annieLinks.first();
  const href = await annie.getAttribute("href");
  if (!href) {
    throw fixturePrecondition("Annie's sidebar link has no href.");
  }
  const route = new URL(href, page.url());
  const match = /^\/([^/]+)$/.exec(route.pathname);
  if (!match?.[1]) {
    throw fixturePrecondition(
      "Annie's sidebar link does not target /{animaId}.",
    );
  }
  const animaId = decodeURIComponent(match[1]);
  const rememberedAnimaId =
    typeof settings.last_active_anima_id === "string"
      ? settings.last_active_anima_id
      : null;
  const settingsUpdated =
    !settingsKnown || rememberedAnimaId === animaId
      ? null
      : page.waitForResponse(
          (candidate) =>
            candidate.request().method() === "PATCH" &&
            new URL(candidate.url()).pathname === "/v1/users/me/settings" &&
            candidate.ok(),
          { timeout: 15_000 },
        );

  if (new URL(page.url()).pathname === route.pathname) {
    return animaId;
  }
  await annie.click();
  await expect(page).toHaveURL(
    new RegExp(`/${encodeURIComponent(animaId)}(?:[?#]|$)`),
  );
  if (settingsUpdated) await settingsUpdated;
  return animaId;
}

/** Follow the visible client-side Library link from any mounted app route. */
async function navigateToLibrary(page: Page): Promise<void> {
  const libraryLink = page.getByRole("link", {
    name: "Library",
    exact: true,
  });
  await expect(libraryLink).toHaveCount(1);
  await expect(libraryLink).toBeVisible();
  await libraryLink.click();
  await expect(page).toHaveURL(/\/library(?:[/?#]|$)/);
  await expect(
    page.getByRole("heading", { name: "Library", exact: true }),
  ).toBeVisible();
}

/** Follow the real Library controls so the selected Anima context stays live. */
async function openFilteredLibrary(args: {
  contentName: string;
  origin: LibraryPreviewOrigin;
  page: Page;
  section: LibraryPreviewSection;
  selectAnnie: boolean;
}): Promise<void> {
  if (args.selectAnnie) await selectAnnieFromSidebar(args.page);
  await navigateToLibrary(args.page);

  const sectionName =
    args.section === "gesture" ||
    args.section === "reaction" ||
    args.section === "pose"
      ? "Actions"
      : "FX";
  const sectionNav = args.page.getByRole("navigation", {
    name: "Library sections",
    exact: true,
  });
  await sectionNav
    .getByRole("button", { name: sectionName, exact: true })
    .click();

  const subsectionName =
    args.section === "gesture"
      ? "Gestures"
      : args.section === "pose"
        ? "Poses"
        : args.section === "reaction"
          ? "Reactions"
          : `${args.section[0]!.toUpperCase()}${args.section.slice(1)} FX`;
  // The inventory disclosure can share the same accessible name; filter
  // buttons do not carry the disclosure's aria-expanded state.
  const subsectionFilter = args.page
    .locator("button:not([aria-expanded])")
    .filter({ hasText: new RegExp(`^${escapeRegExp(subsectionName)}$`) });
  await expect(subsectionFilter).toHaveCount(1);
  await subsectionFilter.click();

  const search = args.page.getByPlaceholder("Search the Library", {
    exact: true,
  });
  await expect(search).toBeVisible();
  await search.fill(args.contentName);

  if (args.origin === "Mine") {
    await args.page
      .getByRole("button", { name: "Filter and sort Library", exact: true })
      .click();
    const starters = args.page.getByRole("menuitemcheckbox", {
      name: "Show starters",
      exact: true,
    });
    await expect(starters).toBeVisible();
    if ((await starters.getAttribute("data-state")) === "checked") {
      await starters.click();
    }
    // The checkbox prevents the menu's default selection close so operators
    // can adjust several filters. Close it explicitly before resolving rows;
    // while the modal menu is open, Radix correctly hides the inventory from
    // the accessibility tree.
    await args.page.keyboard.press("Escape");
    await expect(starters).toBeHidden();
  }
}

/**
 * Resolve one exact origin-qualified row without starting playback. Stateful
 * journeys use this seam to pre-arm network and temporal observers before the
 * visible Preview click.
 */
export async function prepareLibraryPreview(args: {
  contentName: string;
  origin?: LibraryPreviewOrigin;
  page: Page;
  section: LibraryPreviewSection;
  selectAnnie?: boolean;
}): Promise<PreparedLibraryPreview> {
  const origin = args.origin ?? "Included";
  await openFilteredLibrary({
    ...args,
    origin,
    selectAnnie: args.selectAnnie ?? true,
  });

  const namedRows = args.page.getByRole("article", {
    name: args.contentName,
    exact: true,
  });
  const matchingRows = namedRows;
  await expect(matchingRows).toHaveCount(1, { timeout: 15_000 });
  const row = matchingRows.first();
  await expect(row).toBeVisible();
  const preview = row.getByRole("button", { name: "Preview", exact: true });
  await expect(preview).toHaveCount(1);
  const dock = args.page.getByRole("complementary", {
    name: args.contentName,
    exact: true,
  });
  return {
    previewButton: preview,
    surface: dock,
    async open() {
      const family = {
        pose: "poses",
        gesture: "gestures",
        reaction: "reactions",
        particle: "particle-effects",
        avatar: "avatar-effects",
        scene: "scene-effects",
      }[args.section];
      // The preparation response binds the exact Included/Local source;
      // row badges are presentation and are not required for this proof.
      const prepared = args.page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new RegExp(`^/v1/${family}/[^/]+:preview$`).test(
            new URL(response.url()).pathname,
          ),
      );
      await preview.click();
      const response = await prepared;
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as {
        item: { source: string; name: string };
      };
      expect(body.item.source).toBe(
        origin === "Included" ? "included" : "local",
      );
      expect(body.item.name).toBe(args.contentName);
      await expect(dock).toBeVisible({ timeout: 15_000 });
      await expect(dock).toHaveAttribute(
        "data-playback-surface",
        "library-dock",
      );
      return dock;
    },
  };
}

/** Open one exact origin-qualified Library row and return its Preview Dock. */
export async function openLibraryPreview(args: {
  contentName: string;
  origin?: LibraryPreviewOrigin;
  page: Page;
  section: LibraryPreviewSection;
  selectAnnie?: boolean;
}): Promise<Locator> {
  return (await prepareLibraryPreview(args)).open();
}

/**
 * Resolve Annie from the visible roster, follow her real Manage href, and
 * preview a named Loadout row without touching Equip or Save controls.
 */
export async function openAnnieLoadoutPreview(args: {
  contentName: string;
  page: Page;
  section: "gesture" | "reaction";
}): Promise<{ animaId: string; surface: Locator }> {
  const readyRuntimeIds = new Set<string>();
  const recordReadyRuntime = (candidate: Response) => {
    if (candidate.request().method() !== "GET" || !candidate.ok()) {
      return;
    }
    const match = /^\/v1\/animas\/([^/]+)\/runtime$/.exec(
      new URL(candidate.url()).pathname,
    );
    if (!match?.[1]) return;
    try {
      readyRuntimeIds.add(decodeURIComponent(match[1]));
    } catch {
      // An invalid route identity cannot satisfy the exact Annie wait below.
    }
  };
  args.page.on("response", recordReadyRuntime);
  const response = await args.page.goto("/animas", {
    waitUntil: "domcontentloaded",
  });
  if (!response?.ok()) {
    throw fixturePrecondition(
      `Anima roster navigation failed with HTTP ${response?.status() ?? "unknown"}.`,
    );
  }

  const annieSelectors = args.page.getByRole("button", {
    name: "Select Annie",
    exact: true,
  });
  await expect(annieSelectors).toHaveCount(1, { timeout: 15_000 });
  if (!(await annieSelectors.first().isVisible())) {
    throw fixturePrecondition("the one Anima named Annie is not visible.");
  }
  await annieSelectors.first().click();
  await expect(
    args.page.getByRole("heading", { name: "Annie", exact: true }).first(),
  ).toBeVisible();

  const editIdentityLink = args.page.getByRole("link", {
    name: "Edit identity",
    exact: true,
  });
  await expect(editIdentityLink).toHaveCount(1);
  await expect(editIdentityLink).toBeVisible();
  const href = await editIdentityLink.getAttribute("href");
  if (!href) {
    throw fixturePrecondition("Annie's Edit identity link has no href.");
  }
  const route = new URL(href, args.page.url());
  const match = /^\/animas\/([^/]+)\/identity$/.exec(route.pathname);
  if (!match?.[1]) {
    throw fixturePrecondition(
      `Annie's Edit identity link does not target /animas/{animaId}/identity.`,
    );
  }
  const animaId = decodeURIComponent(match[1]);
  // Selecting Annie already navigates through TanStack Router. Waiting for
  // that user-driven transition avoids reloading the complete application and
  // aborting runtime work that the selected Anima has already started.
  await expect(args.page).toHaveURL(
    new RegExp(`/animas/${encodeURIComponent(animaId)}(?:[?#]|$)`),
  );
  await expect(annieSelectors.first()).toHaveAttribute("aria-current", "true");
  await expect
    .poll(() => readyRuntimeIds.has(animaId), {
      message: "wait for Annie's successful runtime response before Preview",
      timeout: 15_000,
    })
    .toBe(true);
  args.page.off("response", recordReadyRuntime);

  const loadoutTab = args.page.getByRole("tab", {
    name: "Loadout",
    exact: true,
  });
  await expect(loadoutTab).toBeVisible({ timeout: 15_000 });
  await loadoutTab.click();
  await expect(
    args.page.getByRole("heading", { name: "Loadout", exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  const sectionName = args.section === "gesture" ? "Gestures" : "Reactions";
  const section = args.page.getByRole("region", {
    name: sectionName,
    exact: true,
  });
  await expect(section).toBeVisible();
  const disclosure = section.getByRole("button", {
    name: sectionName,
    exact: true,
  });
  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");

  if (args.section === "gesture") {
    const search = section.getByRole("searchbox", {
      name: "Search gestures",
      exact: true,
    });
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill(args.contentName);
  } else {
    // The emotion row's name also carries its Reaction count, so find it by
    // the levels region it controls. Included names end in the intensity and
    // a second Reaction's "B", as in "Joy Reaction 4B".
    const emotionName = args.contentName.replace(/ Reaction \d+B?$/, "");
    const emotion = section.locator(
      `button[aria-controls="reaction-${emotionName.toLowerCase()}-levels"]`,
    );
    await expect(emotion).toHaveCount(1, { timeout: 15_000 });
    if ((await emotion.getAttribute("aria-expanded")) !== "true") {
      await emotion.click();
    }
    await expect(emotion).toHaveAttribute("aria-expanded", "true");
  }

  const preview = section.getByRole("button", {
    name: `Preview ${args.contentName}`,
    exact: true,
  });
  await expect(preview).toHaveCount(1, { timeout: 15_000 });
  await expect(preview).toBeEnabled();
  await preview.click();

  const surface = args.page.locator(
    '[data-playback-surface="anima-loadout-stage"]',
  );
  await expect(surface).toHaveCount(1);
  await expect(surface).toBeVisible();
  await expect(surface).toHaveAttribute(
    "aria-label",
    "Interactive preview of Annie",
  );
  return { animaId, surface };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
