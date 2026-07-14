/**
 * services/shell.mjs — argv-list subprocess runner (atomic service).
 *
 * Commands are ALWAYS an explicit `[bin, ...args]` array executed via
 * execFile with `shell: false`, so shell injection is structurally
 * impossible — there is no string a config author can write that becomes
 * shell syntax. `commands.*` atoms are the only callers.
 */

import { execFile } from "node:child_process";

export class ShellError extends Error {
  constructor(argv, code, stdout, stderr) {
    super(`command failed (exit ${code}): ${argv.join(" ")}`);
    this.name = "ShellError";
    this.argv = argv;
    this.exitCode = code;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/**
 * Run an argv list. Resolves { stdout, stderr, exitCode }.
 * @param {string[]} argv e.g. ["git", "status", "--porcelain"]
 * @param {{cwd?: string, env?: object, timeoutMs?: number, allowNonZero?: boolean}} [opts]
 */
export function runArgv(argv, opts = {}) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== "string")) {
    return Promise.reject(new TypeError("runArgv requires a non-empty string array [bin, ...args]"));
  }
  const [bin, ...args] = argv;
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        timeout: opts.timeoutMs ?? 120_000,
        maxBuffer: 16 * 1024 * 1024,
        shell: false,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const exitCode = err ? (typeof err.code === "number" ? err.code : 1) : 0;
        if (err && !opts.allowNonZero) {
          reject(new ShellError(argv, exitCode, String(stdout), String(stderr)));
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr), exitCode });
        }
      },
    );
  });
}
