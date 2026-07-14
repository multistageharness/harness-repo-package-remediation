/**
 * src/version-discovery-cli.mjs — the thin `find-version` CLI verb over the
 * version-discovery engine (change record 0033/D0 surface (c)), mirroring the
 * playground's `cli.mjs → SDK → main.mjs` layering: `bin/flow.mjs` dispatches
 * `flow find-version …` here; everything below the arg parse is the engine.
 *
 *   flow find-version <verb> <package-manager> <package> [flags]
 *     verb             versions | find | test
 *     package-manager  npm | pnpm | pip | poetry | uv | conda | maven | cargo | docker
 *
 *   flags: --current <v>     rank only candidates above this version
 *          --limit <n>       cap the candidates (after ordering)
 *          --order <asc|desc>  desc = newest-first (default), asc = minimal bump
 *          --registry <url>  override the adapter's datasource base URL
 *          --report <path>   (test) also write the JSON report here
 *          --timeout-ms <n>  per-candidate install-test budget
 *          --mock            deterministic synthetic run — no network, no subprocess
 *
 * Pure w.r.t. the injected io seam (tests capture stdout/stderr); prints the
 * engine's JSON envelope verbatim so consuming scripts never scrape prose.
 */

import { versions, find, test, getAdapter, VERSION_DISCOVERY_ADAPTERS } from "./version-discovery.mjs";

const VERBS = { versions, find, test };

export const FIND_VERSION_USAGE = [
  "usage: flow find-version <verb> <package-manager> <package> [flags]",
  `  verb             ${Object.keys(VERBS).join(" | ")}`,
  `  package-manager  ${Object.keys(VERSION_DISCOVERY_ADAPTERS).join(" | ")}`,
  "  flags            --current <v> --limit <n> --order <asc|desc> --registry <url>",
  "                   --report <path> --timeout-ms <n> --mock",
].join("\n");

/**
 * Parse `find-version` args (everything after the `find-version` token).
 * @returns {{verb: string, packageManager: string, pkg: string, opts: object, mock: boolean}}
 * @throws {Error} on an unusable invocation — the caller prints usage.
 */
export function parseFindVersionArgs(argv) {
  const positional = [];
  const opts = {};
  let mock = false;
  const takesValue = { "--current": "current", "--limit": "limit", "--order": "order", "--registry": "registryUrl", "--report": "reportPath", "--timeout-ms": "timeoutMs" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--mock") {
      mock = true;
    } else if (Object.hasOwn(takesValue, token)) {
      const value = argv[i + 1];
      if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) throw new Error(`${token} needs a value`);
      opts[takesValue[token]] = value;
      i += 1;
    } else if (token.startsWith("--")) {
      throw new Error(`unknown flag '${token}'`);
    } else {
      positional.push(token);
    }
  }
  const [verb, packageManager, pkg] = positional;
  if (positional.length !== 3) throw new Error("expected exactly <verb> <package-manager> <package>");
  if (!Object.hasOwn(VERBS, verb)) throw new Error(`unknown verb '${verb}' (expected ${Object.keys(VERBS).join(" | ")})`);
  if (getAdapter(packageManager) === null) throw new Error(`unknown package manager '${packageManager}' (known: ${Object.keys(VERSION_DISCOVERY_ADAPTERS).join(" | ")})`);
  for (const key of ["limit", "timeoutMs"]) {
    if (opts[key] !== undefined) {
      const n = Number(opts[key]);
      if (!Number.isInteger(n) || n < 1) throw new Error(`--${key === "limit" ? "limit" : "timeout-ms"} must be a positive integer`);
      opts[key] = n;
    }
  }
  if (opts.order !== undefined && opts.order !== "asc" && opts.order !== "desc") throw new Error("--order must be 'asc' or 'desc'");
  return { verb, packageManager, pkg, opts, mock };
}

/**
 * Run the CLI verb; returns a process exit code. `io` is the seam tests drive
 * (`{stdout, stderr}` line sinks); real callers get console defaults.
 */
export async function runFindVersionCli(argv, io = {}) {
  const stdout = io.stdout ?? ((line) => console.log(line));
  const stderr = io.stderr ?? ((line) => console.error(line));
  let parsed;
  try {
    parsed = parseFindVersionArgs(argv);
  } catch (err) {
    stderr(`find-version: ${err.message}`);
    stderr(FIND_VERSION_USAGE);
    return 1;
  }
  try {
    const ctx = { options: { mock: parsed.mock } };
    const result = await VERBS[parsed.verb](parsed.packageManager, parsed.pkg, parsed.opts, ctx);
    stdout(JSON.stringify(result, null, 2));
    // `find` that found nothing is a MEANINGFUL miss, not a crash — signalled
    // via the exit code so shell callers can branch without parsing JSON.
    return parsed.verb === "find" && result.found !== true ? 1 : 0;
  } catch (err) {
    stderr(`find-version: ${err.message}`);
    return 1;
  }
}
