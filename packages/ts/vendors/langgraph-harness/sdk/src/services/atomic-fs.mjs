/**
 * services/atomic-fs.mjs — atomic file writes (atomic service).
 *
 * Write-temp → fsync → rename, so a crash can never leave a half-written
 * artifact. Every file the platform emits (reports, file checkpoints,
 * vector-store snapshots) goes through here.
 */

import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Atomically write `content` (string or Buffer) to `filePath`, creating
 * parent directories as needed.
 */
export async function writeFileAtomic(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = join(dirname(filePath), `.${randomBytes(6).toString("hex")}.tmp`);
  const fh = await open(tmp, "w");
  try {
    await fh.writeFile(content);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, filePath);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
