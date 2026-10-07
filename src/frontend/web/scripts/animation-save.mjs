import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Save reviewed Gesture clips as Local content through the Gesture creator.
 *
 *   pnpm -s animation:save <items.json> [--url <app origin>]
 *
 * `items.json` lists `{ clip, name, aiDescription, selectorId, description? }`
 * entries (clip paths are relative to the items file; the Library description
 * defaults to the AI description). Each item is saved in turn in
 * a headless browser, exactly as a person would: a new Gesture is imported as
 * a creator project file and saved; when a Local Gesture with that Selector
 * ID already exists, its clip is imported into that item and saved as a
 * revision. The app origin defaults to the sourced stack's
 * ANIMAMA_PUBLIC_ORIGIN, then http://localhost:8000.
 */

const SELECTOR_ID = /^[a-z][a-z0-9_]*$/;
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
        `${where}: Selector ID "${item.selectorId}" must be lowercase snake_case.`,
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

async function readClip(file) {
  const sequence = JSON.parse(await readFile(file, "utf8"));
  if (sequence?.schema !== "animaPoseClip/2.0")
    throw new Error(
      `${file}: expected an animaPoseClip/2.0 clip (run animation validate).`,
    );
  return sequence;
}

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
    // Same-origin read of the Library, as the app itself makes it.
    const existing = await page.evaluate(async () => {
      const response = await fetch("/v1/gestures?limit=500");
      if (!response.ok) throw new Error(`Library ${response.status}`);
      const body = await response.json();
      return (body.items ?? [])
        .filter((item) => item.source === "local" && item.semantic_key)
        .map((item) => [item.semantic_key, item.item_id]);
    });
    const localIds = new Map(existing);

    for (const [index, item] of items.entries()) {
      try {
        const sequence = clips[index];
        const itemId = localIds.get(item.selectorId);
        await page.goto(
          itemId
            ? `/gestures/${encodeURIComponent(itemId)}/edit`
            : "/gestures/new",
        );
        await page
          .locator('[data-testid="action-editor-canvas"]:visible')
          .waitFor();
        await page.getByRole("tab", { name: "Clip", exact: true }).click();
        await page
          .getByRole("button", { name: "Import", exact: true })
          .first()
          .click();
        const file = page.locator(
          '[role="dialog"] input[type="file"][accept=".json,application/json"]',
        );
        // A project file sets the clip, name, AI description and Selector ID
        // together; imported into an open item, it keeps that item.
        await file.setInputFiles({
          name: `${item.selectorId}.project.json`,
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(gestureProject(item, sequence))),
        });
        await page
          .getByText("Typed project imported with exact dependency pins.")
          .waitFor();
        await page.keyboard.press("Escape");
        // The import notice can cover Save; wait for it to close.
        await page.mouse.move(0, 0);
        await page
          .getByRole("region", { name: /Notifications/ })
          .getByText(/imported/)
          .waitFor({ state: "detached", timeout: 15_000 })
          .catch(() => {});
        const save = page.getByRole("button", {
          name: "Save content",
          exact: true,
        });
        // Save stays disabled when the saved item already matches.
        if (itemId && (await save.isDisabled())) {
          onSaved({
            selectorId: item.selectorId,
            url: page.url(),
            unchanged: true,
          });
          continue;
        }
        const saved = page.waitForResponse(
          (response) =>
            ["PUT", "POST", "PATCH"].includes(response.request().method()) &&
            /\/v1\/gestures/.test(response.url()) &&
            response.ok(),
          { timeout: 60_000 },
        );
        // Settled even if the click fails, so the failure is the one reported.
        saved.catch(() => {});
        await save.click();
        await saved;
        if (!itemId)
          await page.waitForURL(/\/gestures\/[^/]+\/edit/, { timeout: 60_000 });
        // Reopen: the saved clip must load with its beats.
        const url = page.url();
        await page.reload();
        await page.getByRole("tab", { name: "Clip", exact: true }).click();
        const first = sequence.beats[0];
        await page
          .getByRole("button", {
            name: new RegExp(
              `^${first.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} keyframe at 0\\.00s`,
            ),
          })
          .first()
          .waitFor();
        onSaved({ selectorId: item.selectorId, url, revised: Boolean(itemId) });
      } catch (error) {
        throw new Error(`${item.selectorId}: ${error.message.split("\n")[0]}`);
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
