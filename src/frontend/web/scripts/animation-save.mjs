import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Save reviewed Gesture clips as Local content through the Gesture creator.
 *
 *   pnpm -s animation:save <items.json> [--url <app origin>]
 *
 * `items.json` lists `{ clip, name, aiDescription, selectorId, description? }`
 * entries (clip paths are relative to the items file). Each item is saved in
 * turn in a headless browser, exactly as a person would:
 *
 * - a new Selector ID: a creator project file (clip, name, descriptions and
 *   Selector ID) is imported into a new Gesture and saved; the Library
 *   description defaults to the AI description;
 * - a Local Gesture's Selector ID: that item is opened, the clip is imported
 *   into it (keeping its name, components, notes and description), its AI
 *   description is set, and it is saved as a revision (reported unchanged
 *   only if the creator finds nothing to save). The item's name must match:
 *   renaming is refused, since the creator can re-derive the Selector ID
 *   from a new name.
 *
 * After each save the Library item is read back to confirm its Selector ID.
 *
 * The app origin defaults to the sourced stack's ANIMAMA_PUBLIC_ORIGIN, then
 * http://localhost:8000.
 */

/** The Selector IDs the backend accepts. */
const SELECTOR_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const PROJECT_SCHEMA = "animamaActionProject/1.0";

/** A save item as the tool uses it, or a thrown error naming the problem. */
export function parseSaveItems(value, itemsFile) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${itemsFile}: expected a non-empty array of items.`);
  const seen = new Set();
  return value.map((item, index) => {
    const where = `${itemsFile} item ${index + 1}`;
    for (const field of ["clip", "name", "aiDescription", "selectorId"])
      if (typeof item?.[field] !== "string" || !item[field].trim())
        throw new Error(`${where}: "${field}" must be a non-empty string.`);
    if (!SELECTOR_ID.test(item.selectorId))
      throw new Error(
        `${where}: Selector ID "${item.selectorId}" must be lowercase letters, digits, "_", "-" or "." (snake_case preferred).`,
      );
    if (seen.has(item.selectorId))
      throw new Error(`${where}: Selector ID "${item.selectorId}" repeats.`);
    seen.add(item.selectorId);
    if (item.description !== undefined && typeof item.description !== "string")
      throw new Error(`${where}: "description" must be a string.`);
    return {
      clip: path.resolve(path.dirname(itemsFile), item.clip),
      name: item.name.trim(),
      aiDescription: item.aiDescription.trim(),
      description: item.description?.trim() || item.aiDescription.trim(),
      selectorId: item.selectorId,
    };
  });
}

/** The creator project file a new Gesture is imported from. */
export function gestureProject(item, sequence) {
  return {
    schema: PROJECT_SCHEMA,
    intent: "gesture",
    name: item.name,
    description: item.description,
    aiDescription: item.aiDescription,
    semanticKey: item.selectorId,
    sequence,
    dependencies: [],
  };
}

/**
 * Which Library item each save targets: a Local item to revise, or none (a
 * new item). A Selector ID held only by an Included Gesture is refused: a
 * Local copy needs its own Selector ID.
 */
export function planSaves(items, libraryItems) {
  return items.map((item) => {
    const matches = libraryItems.filter(
      ({ semantic_key }) => semantic_key === item.selectorId,
    );
    const local = matches.find(({ source }) => source === "local");
    if (!local && matches.length > 0)
      throw new Error(
        `Selector ID "${item.selectorId}" belongs to an Included Gesture; give the Local Gesture its own Selector ID.`,
      );
    // The creator re-derives a saved Gesture's Selector ID from a new name
    // when they match, so a rename could silently change how chat selects it.
    if (local && local.name !== item.name)
      throw new Error(
        `"${item.selectorId}" is saved as "${local.name}": keep that name to revise it (a rename can change its Selector ID).`,
      );
    return local ? { itemId: local.item_id, name: local.name } : null;
  });
}

async function readClip(file) {
  let sequence;
  try {
    sequence = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
  if (sequence?.schema !== "animaPoseClip/2.0" || !sequence.beats?.length)
    throw new Error(
      `${file}: expected an animaPoseClip/2.0 clip (run animation validate).`,
    );
  return sequence;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Save each item through the creator, in order. `onSaved` receives
 * `{ selectorId, url, revised?, unchanged? }` as each one is saved and
 * reopened (or found already up to date), so a later failure does not hide
 * earlier saves.
 */
export async function saveGestures(items, origin, onSaved = () => {}) {
  const { chromium } = await import("playwright");
  const clips = await Promise.all(items.map(({ clip }) => readClip(clip)));
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader-webgl",
      "--enable-unsafe-swiftshader",
    ],
  });
  try {
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(240_000);
    await page.goto("/");
    // Same-origin read of the whole Library, as the app itself makes it.
    const library = await page.evaluate(async () => {
      const response = await fetch("/v1/gestures");
      if (!response.ok) throw new Error(`Library request ${response.status}`);
      return (await response.json()).items ?? [];
    });
    const targets = planSaves(items, library);
    const save = page.getByRole("button", {
      name: "Save content",
      exact: true,
    });

    for (const [index, item] of items.entries()) {
      let step = "open the creator";
      try {
        const sequence = clips[index];
        const target = targets[index];
        await page.goto(
          target
            ? `/gestures/${encodeURIComponent(target.itemId)}/edit`
            : "/gestures/new",
        );
        await page
          .locator('[data-testid="action-editor-canvas"]:visible')
          .waitFor();
        if (target) {
          // Import only once the saved item has loaded: a late load would
          // replace the imported clip.
          step = "load the saved item";
          await page.waitForFunction(
            (name) =>
              document.querySelector('[aria-label="gesture name"]')?.value ===
              name,
            target.name,
            { timeout: 60_000 },
          );
          // A clean item shows Save disabled; an unsaved local draft of it
          // keeps Save enabled, and the import below replaces that draft.
          await page
            .waitForFunction(
              () =>
                document.querySelector('[aria-label="Save content"]')?.disabled,
              null,
              { timeout: 5_000 },
            )
            .catch(() => {});
        }
        step = "import the clip";
        await page.getByRole("tab", { name: "Clip", exact: true }).click();
        await page
          .getByRole("button", { name: "Import", exact: true })
          .first()
          .click();
        const file = page.locator(
          '[role="dialog"] input[type="file"][accept=".json,application/json"]',
        );
        if (target) {
          // A plain clip import keeps the item's components, notes and
          // description; only the clip, name and AI description change.
          await file.setInputFiles({
            name: `${item.selectorId}.clip.json`,
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(sequence)),
          });
          await page.getByText("Anima Pose Clip imported.").first().waitFor();
          await page.keyboard.press("Escape");
          await page
            .getByLabel("AI selection description", { exact: true })
            .first()
            .fill(item.aiDescription);
        } else {
          await file.setInputFiles({
            name: `${item.selectorId}.project.json`,
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(gestureProject(item, sequence))),
          });
          await page
            .getByText("Typed project imported with exact dependency pins.")
            .waitFor();
          await page.keyboard.press("Escape");
        }
        // The import notice can cover Save; wait for it to close.
        await page.mouse.move(0, 0);
        await page
          .getByRole("region", { name: /Notifications/ })
          .getByText(/imported/)
          .waitFor({ state: "detached", timeout: 15_000 })
          .catch(() => {});
        // Save stays disabled when the saved item already matches.
        if (target && (await save.isDisabled())) {
          onSaved({
            selectorId: item.selectorId,
            url: page.url(),
            unchanged: true,
          });
          continue;
        }
        step = "save";
        const response = page.waitForResponse(
          (candidate) =>
            ["PUT", "POST", "PATCH"].includes(candidate.request().method()) &&
            /\/v1\/gestures/.test(candidate.url()),
          { timeout: 60_000 },
        );
        // Settled even if the click fails, so the failure is the one reported.
        response.catch(() => {});
        await save.click();
        const result = await response;
        if (!result.ok())
          throw new Error(
            `the app refused the save (${result.status()}): ${(await result.text()).slice(0, 300)}`,
          );
        // The creator announces the save once it has finished (and cleared
        // its local draft), so the reopen loads the saved item.
        await page
          .getByText("Gesture saved.", { exact: true })
          .first()
          .waitFor({ timeout: 60_000 });
        if (!target)
          await page.waitForURL(/\/gestures\/[^/]+\/edit/, { timeout: 60_000 });
        step = "confirm the Selector ID";
        const itemId =
          target?.itemId ??
          decodeURIComponent(
            new URL(page.url()).pathname.split("/").at(-2) ?? "",
          );
        const savedKey = await page.evaluate(async (id) => {
          const response = await fetch(
            `/v1/gestures/${encodeURIComponent(id)}`,
          );
          return response.ok ? (await response.json()).semantic_key : null;
        }, itemId);
        if (savedKey !== item.selectorId)
          throw new Error(
            `saved with Selector ID "${savedKey}" instead of "${item.selectorId}"`,
          );
        step = "reopen the saved item";
        const url = page.url();
        await page.reload();
        await page.getByRole("tab", { name: "Clip", exact: true }).click();
        await page
          .getByRole("button", {
            name: new RegExp(
              `^${escapeRegExp(sequence.beats[0].label)} keyframe at`,
            ),
          })
          .first()
          .waitFor();
        onSaved({ selectorId: item.selectorId, url, revised: Boolean(target) });
      } catch (error) {
        throw new Error(
          `${item.selectorId}: could not ${step}: ${error.message.split("\n")[0]}`,
        );
      }
    }
  } finally {
    await browser.close();
  }
}

const USAGE = `Usage: pnpm -s animation:save <items.json> [--url <app origin>]

items.json: [{ "clip": "<file>.clip.json", "name": "...", "aiDescription": "...",
               "selectorId": "lower_snake_case", "description"?: "..." }]
A Local Gesture with the same Selector ID is revised; otherwise a new one is
saved. The origin defaults to ANIMAMA_PUBLIC_ORIGIN (source the stack record),
then http://localhost:8000.`;

async function main(argv) {
  const urlIndex = argv.indexOf("--url");
  const origin =
    urlIndex >= 0
      ? argv[urlIndex + 1]
      : (process.env.ANIMAMA_PUBLIC_ORIGIN ?? "http://localhost:8000");
  const positional =
    urlIndex >= 0
      ? argv.filter(
          (_value, index) => index !== urlIndex && index !== urlIndex + 1,
        )
      : argv;
  if (
    argv.includes("--help") ||
    positional.length !== 1 ||
    !origin ||
    origin.startsWith("--")
  ) {
    console.log(USAGE);
    return argv.includes("--help") ? 0 : 2;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const itemsFile = path.resolve(cwd, positional[0]);
  let items;
  try {
    items = parseSaveItems(
      JSON.parse(await readFile(itemsFile, "utf8")),
      itemsFile,
    );
  } catch (error) {
    console.log(error.message);
    return 1;
  }
  try {
    await saveGestures(
      items,
      origin,
      ({ selectorId, url, revised, unchanged }) =>
        console.log(
          `${unchanged ? "Unchanged" : revised ? "Revised" : "Saved"} ${selectorId}: ${url}`,
        ),
    );
  } catch (error) {
    console.log(`Save failed: ${error.message.split("\n")[0]}`);
    return 1;
  }
  return 0;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exit(await main(process.argv.slice(2)));
}
