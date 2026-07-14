/**
 * src/ingest-lanes.mjs — the single source of truth for "what can we ingest".
 *
 * Change record 0021 re-opens the ingest source as a user selection, but as a
 * TYPED, CONTRACT-CORRECT route rather than the free `commands.*` atom pick that
 * record 0001/A1 removed. This module is what makes the difference structural:
 * a CLOSED enum of six lanes, each of which names a lane INSIDE
 * `configs/flows/ingest.yaml` whose atom params that child flow — not the user —
 * fixes. The parent's `ingest` node params (`config`, `map_in`, `map_out`) are
 * constant across all six, so no selection can emit an invalid `nodes[0]`.
 *
 * Shared by the wizard's `ingest-source` + `input-file` steps, the FlowPlan
 * contract, the renderer, and the `commands.ingestUnknownSource` atom, so the
 * menu the user sees, the yaml the wizard emits, and the tokens the child flow's
 * router accepts can never drift apart.
 *
 * Pure: no I/O except the two filesystem guards, which are the point of the
 * `local_*` lanes. No seam, no network.
 */

import { existsSync } from "node:fs";
import { extname } from "node:path";

import { looksLikeRepoUrl } from "./repo-url.mjs";

/** Extensions `@harness/sdk`'s `ingest()` can read (mirrors input-file.mjs). */
const SUPPORTED_EXT = [".csv", ".xlsx"];

/**
 * The six lanes, in menu order.
 *
 * `ref` names what the lane's `ingest_ref` holds (and therefore what the
 * `input-file` step prompts for); `null` means the lane takes no reference.
 * `placeholder: true` marks the two lanes that ship as stub extractors (0021/D4)
 * — they route and validate, but ingest zero rows until their acquisition
 * integration lands.
 * `repoSource: true` marks the lanes that synthesize their dataset from ONE repo
 * reference — the single array `[{repo, repo_url}]`, with no `package` /
 * `recommended_version` columns. These lanes still REMEDIATE (record 0023/A1:
 * `commands.repoRemediate` takes the repo's extracted dependencies as candidates
 * and resolves each target from the registry); what they skip is the spreadsheet,
 * hence step 3's `select_headers` (0023/A2). They are NOT scan-only — the
 * `scanOnly` flag 0021/A5 introduced was wrong and is gone.
 */
export const INGEST_LANES = [
  {
    value: "local_csv",
    label: "Local CSV/XLSX file",
    hint: "a Dependabot-style spreadsheet on disk",
    ref: "path",
    prompt: "Input CSV/XLSX file",
    placeholder: "path/to/data.csv",
  },
  {
    value: "remote_csv",
    label: "Remote CSV/XLSX (fetched over https)",
    hint: "downloaded, neutralized (zero-trust), then parsed in memory",
    ref: "url",
    prompt: "Remote CSV/XLSX URL (https)",
    placeholder: "https://example.com/dependabot.csv",
  },
  {
    value: "local_repo",
    label: "Local repo directory (one row)",
    hint: "one synthesized row; targets resolved from the registry, not a spreadsheet",
    ref: "dir",
    repoSource: true,
    prompt: "Local repo directory (must contain .git/)",
    placeholder: "path/to/checkout",
  },
  {
    value: "remote_repo",
    label: "Remote repo URL (one row)",
    hint: "one synthesized row; targets resolved from the registry, not a spreadsheet",
    ref: "repo_url",
    repoSource: true,
    prompt: "Remote repo URL",
    placeholder: "https://github.com/owner/repo",
  },
  {
    value: "preset_list",
    label: "Preset list of repos (placeholder)",
    hint: "not implemented — ingests zero rows",
    ref: null,
    placeholder_lane: true,
  },
  {
    value: "dependabot",
    label: "GitHub Dependabot alerts (placeholder)",
    hint: "not implemented — ingests zero rows",
    ref: null,
    placeholder_lane: true,
  },
];

/** The six legal `ingest_source` tokens — the child router's closed enum. */
export const INGEST_SOURCES = INGEST_LANES.map((l) => l.value);

/** @param {string} value @returns {object|undefined} */
export const laneFor = (value) => INGEST_LANES.find((l) => l.value === value);

/** True when the lane needs an `ingest_ref` (path / URL / dir). */
export const laneNeedsRef = (value) => laneFor(value)?.ref != null;

/** True for the two stub-under-mock lanes that ingest zero rows (0021/D4). */
export const isPlaceholderLane = (value) => laneFor(value)?.placeholder_lane === true;

/**
 * True for the two lanes whose dataset is synthesized from one repo reference
 * (0023/A1). They ingest a single `[{repo, repo_url}]` array — no `package` /
 * `recommended_version` — and so BYPASS step 3's `select_headers` (0023/A2)
 * while still remediating off registry-resolved targets.
 */
export const isRepoSourceLane = (value) => laneFor(value)?.repoSource === true;

/** The lane tokens the parent flow's `dataset_init` switch routes past `select_headers`. */
export const REPO_SOURCE_LANES = INGEST_LANES.filter((l) => l.repoSource === true).map((l) => l.value);

/**
 * The atoms each lane's chain needs present in the mapping. `mappingStep`
 * asserts exactly the chosen lane's set (plus the two every run needs), so a
 * mapping that can't serve the selection fails at the wizard, not mid-run.
 */
export const LANE_ATOMS = {
  local_csv: ["commands.harnessIngest"],
  remote_csv: ["commands.httpFetch", "commands.sanitizeUntrusted", "commands.harnessIngest"],
  local_repo: ["commands.repoRowSynthesize"],
  remote_repo: ["commands.repoRowSynthesize"],
  preset_list: ["commands.ingestPreset"],
  dependabot: ["commands.ingestDependabot"],
};

/** Needed whatever the selection: the orchestrator node and the loud-fail lane. */
export const ALWAYS_ATOMS = ["nodes.subgraph", "commands.ingestUnknownSource"];

/**
 * Pure guard for the `remote_csv` lane (0021/A3): https only — an `http://`
 * fetch of a file we are about to parse and hand downstream is not acceptable —
 * and a `.csv`/`.xlsx` path, unless the caller forces a `format`.
 * @param {string} url
 * @param {{format?: string}} [opts] an explicit format override skips the extension check
 * @returns {{ok: boolean, reason?: string}}
 */
export function validateRemoteCsvUrl(url, { format } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return { ok: false, reason: "not a URL" };
  }
  if (parsed.protocol !== "https:") return { ok: false, reason: "https:// required" };
  if (format) return { ok: true };
  const ext = extname(parsed.pathname).toLowerCase();
  if (!SUPPORTED_EXT.includes(ext)) {
    return { ok: false, reason: "URL path must end in .csv or .xlsx (or pass an explicit format)" };
  }
  return { ok: true };
}

/**
 * Pure guard for the `local_repo` lane (0021/A3): the directory must exist and
 * be a git checkout. `commands.repoRowSynthesize` re-checks both at run time —
 * this is the fast, in-wizard version so the user corrects it before materializing.
 * @param {string} abs absolute directory path
 * @returns {{ok: boolean, reason?: string}}
 */
export function validateLocalRepoDir(abs) {
  if (!existsSync(abs)) return { ok: false, reason: "directory not found" };
  if (!existsSync(`${abs}/.git`)) return { ok: false, reason: "not a git repository (no .git/)" };
  return { ok: true };
}

/** Pure guard for the `remote_repo` lane — reuses the shared repo-URL canon. */
export function validateRemoteRepoUrl(url) {
  return looksLikeRepoUrl(url)
    ? { ok: true }
    : { ok: false, reason: "expected https://host/owner/repo or git@host:owner/repo" };
}
