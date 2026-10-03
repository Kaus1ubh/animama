import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Windows creates symbolic links only with Developer Mode or elevation. */
export const symlinksAvailable = (() => {
  const root = mkdtempSync(path.join(tmpdir(), "animama-symlink-probe-"));
  try {
    writeFileSync(path.join(root, "target"), "");
    symlinkSync(path.join(root, "target"), path.join(root, "link"));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
})();
