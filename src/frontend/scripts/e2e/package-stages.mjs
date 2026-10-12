/**
 * Package import and export stages opened by a browser journey.
 *
 * The backend admits at most two open stages per owner. A committed import or
 * an undownloaded export review keeps counting until it expires (30 minutes)
 * unless the sharing dialog releases it, and a journey may navigate away first.
 * Fixtures release what a journey left open, so later journeys start below the
 * limit instead of depending on how long ago earlier journeys ran.
 */

const EXPORTS_PATH = "/v1/content/package-exports";
const IMPORTS_PATH = "/v1/content/package-imports";
const STAGE_PATH =
  /^\/v1\/content\/package-(?:exports|imports)\/([0-9a-f]{32})$/;
const STAGE_ID = /^[0-9a-f]{32}$/;
/** The backend's reply for a stage that was already released or expired. */
const ABSENT_CODE = "package_stage_unavailable";

function exactStageId(value) {
  if (typeof value !== "string" || !STAGE_ID.test(value)) {
    throw new Error("Package stage reply did not name one exact stage ID.");
  }
  return value;
}

/** Stage IDs come from server replies, never from names or guessed paths. */
export class PackageStageLedger {
  #open = new Map();

  /**
   * Record a stage opened or released by one browser response. Only a 204
   * releases a stage; anything else is confirmed by the fixture's own discard.
   * @param {{ method: string, url: string, status: number, json: () => Promise<any> }} response
   */
  async observe({ method, url, status, json }) {
    const { pathname } = new URL(url);
    if (method === "POST" && status >= 200 && status < 300) {
      if (pathname === EXPORTS_PATH) {
        this.#open.set(exactStageId((await json())?.export_id), "export");
      } else if (pathname === IMPORTS_PATH) {
        this.#open.set(exactStageId((await json())?.stage_id), "import");
      }
      return;
    }
    const released =
      method === "DELETE" && status === 204 && STAGE_PATH.exec(pathname);
    if (released) this.#open.delete(released[1]);
  }

  /** @returns {{ kind: "import" | "export", stageId: string }[]} */
  open() {
    return [...this.#open].map(([stageId, kind]) => ({ kind, stageId }));
  }
}

/**
 * Discard each stage, waiting while a finishing download or commit still holds
 * its lease. Returns every outcome, including stages that stayed held.
 */
export async function releasePackageStages(
  client,
  stages,
  {
    attempts = 20,
    delayMs = 250,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  const released = [];
  const held = [];
  for (const stage of stages) {
    for (let attempt = 1; ; attempt += 1) {
      const { status, code } = await client.discardPackageStage(
        stage.kind,
        stage.stageId,
      );
      if (status === 204 || (status === 404 && code === ABSENT_CODE)) {
        released.push({
          ...stage,
          outcome: status === 204 ? "released" : "absent",
        });
        break;
      }
      if (
        status === 409 &&
        code === "package_stage_active" &&
        attempt < attempts
      ) {
        await wait(delayMs);
        continue;
      }
      held.push({ ...stage, status, code });
      break;
    }
  }
  return { released, held };
}
