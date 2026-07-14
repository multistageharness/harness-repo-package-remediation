/**
 * commands.repoFingerprint — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): fingerprint each cloned
 * repo (`langgraph-flow.md` step 7). Reads the `clone_results` channel emitted by
 * `commands.gitCloneClassified` (each `{ dir, url, cloned|existed|mocked|failed }`)
 * and produces a flat `fingerprints` array — one `{ url, dir, fingerprint,
 * dependencies, artifactVersion }` per repo (plus `cloneError` on failed clones —
 * 0019/A1/A2) — that the fingerprint report node writes to
 * `.harness/fingerprints.json`.
 *
 * Engine: the vendored, dependency-free **bash** presence-scanner
 * (`harness-repo-package-remediation/vendors/repository-fingerprint/packages/bash/repo-fingerprint.sh`,
 * needs only bash/jq/find — no npm install, no build step). It is invoked as an
 * ARGV LIST through the SDK's `runArgv` shell service (shell injection is
 * structurally impossible — security rule 4), never an interpolated command
 * string. The scanner emits exit 1 ("no ecosystem detected") with a still-valid
 * report, so non-zero exits are allowed and parsed rather than thrown.
 *
 * Deep scan (change record 0006/D2): the optional `deep` param (default TRUE)
 * appends the scanner's opt-in `--deep` flag, enabling the monorepo-aware
 * dominance fallback, `subRepos[]` enumeration, and marker-less monorepo
 * topology inference — so "multi-repo" clones with no root manifest (e.g.
 * carlosmarte-testcases-vulnerabilities/multi-repo-npm) resolve a real
 * `dominantEcosystem` instead of degrading downstream. Set `deep: false` in the
 * flow yaml to run the pre-deep contract byte-for-byte.
 *
 * Mock seam (offline acceptance contract): under `ctx.options.mock` — or for any
 * entry the clone stage marked `mocked` or whose `dir` is absent on disk — the
 * atom returns a deterministic STUB fingerprint with NO filesystem read, NO
 * subprocess, NO network. Reaches no provider SDK; any credentials env-only.
 *
 * Trust boundary: this mapping module lives under `configs/patterns/` (satisfied);
 * its relative imports of `../../src/sdk.mjs` (the vendored SDK's `runArgv`) and
 * `../../src/fingerprint-lib.mjs` (the repository-fingerprint report library's
 * stub/parse shaping) both resolve inside the pack. Those two `src/` bridges are
 * the only sites that reach across a vendor boundary — the pattern files never do.
 */

import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runArgv } from "../../src/sdk.mjs";
// Report shaping (stub + parse-or-degrade) is OWNED by the repository-fingerprint
// report library, bridged through the pack's single cross-vendor import site.
import { stubFingerprint, parseReport } from "../../src/fingerprint-lib.mjs";
// Per-dependency extraction (0019/A2+D1): manifest-parsed `dependencies[]` is a
// SIBLING field on the harness entry — never inside the vendored Detection
// Report — populated by the zero-dep extractors on real runs and by the
// deterministic slug-keyed stub on mock/failed/missing paths.
import { extractManifestDependencies, stubDependencies } from "../../src/manifest-deps.mjs";
// Versioned-artifact migrations (0019/D1): fresh entries are stamped with the
// current artifact version; entries re-entering from a pre-existing channel
// value are normalized (e.g. v1.0 artifacts gain `dependencies: []`).
import { normalizeFingerprintEntry, CURRENT_ARTIFACT_VERSION } from "../../src/report-migrations.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// configs/patterns → ../../.. == harness-repo-package-remediation/vendors, then into the pristine mirror.
const FINGERPRINT_SH = resolve(here, "..", "..", "..", "repository-fingerprint", "packages", "bash", "repo-fingerprint.sh");

export const meta = {
  name: "commands.repoFingerprint",
  category: "commands",
  summary: "Fingerprint each cloned repo dir (bash presence-scanner, argv-list, mock-aware) → fingerprints channel.",
  params: {
    type: "object",
    required: ["clones_from", "into"],
    properties: {
      clones_from: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
      deep: { type: "boolean" },
    },
  },
  returns: "node",
};

export function repoFingerprint(params, ctx) {
  return async (state) => {
    const clones = Array.isArray(state[params.clones_from]) ? state[params.clones_from] : [];
    const deep = params.deep !== false;
    const fingerprints = [];
    const total = clones.length;
    let index = 0;
    for (const clone of clones) {
      // Per-item progress tick (change record 0012/A1). This atom loops over all
      // clones inside a SINGLE `fingerprint` node, so the SDK's per-node
      // `node.start`/`node.end` can't drive a live bar. We emit one bounded,
      // idempotent event per repo — keyed to this node id, 1-based index, known
      // total — that `makeProgressRenderer` turns into the same animated bar the
      // clone fan-out gets. The custom `stage.progress` name is NOT an SDK
      // `EVENT_TYPES` member (the vendored hub THROWS on unknown types, so a new
      // name is impossible without editing the pristine SDK — barred by platform
      // rules 1/6); we REUSE the known `loop.guard` type (this IS a bounded loop
      // over N repos) with a `kind: "stage"` discriminator the renderer keys on.
      // No pristine-SDK edit; the emit stays inside the pack's trust boundary.
      index += 1;
      ctx.emit?.("loop.guard", { node: ctx.node?.id, count: index, max: total, kind: "stage" });
      const url = clone?.url ?? null;
      const dir = clone?.dir ?? null;

      // Failed clone (0019/A1): the classified clone atom records failures as
      // data — surface them as a distinguishable stub carrying `cloneError`
      // (sibling field; the vendored Detection Report schema is untouched).
      // Checked FIRST — an explicit `failed: true` shape is legible failure
      // data on every path (incl. mock), unlike the mock/missing-dir collapse.
      if (clone?.failed === true) {
        fingerprints.push({ url, dir, fingerprint: stubFingerprint(dir), cloneError: clone.errorClass ?? "unknown", dependencies: stubDependencies(dir), artifactVersion: CURRENT_ARTIFACT_VERSION });
        continue;
      }

      // Stub under mock, for mock-cloned entries, or when there is no real dir.
      if (ctx.options.mock || clone?.mocked === true || typeof dir !== "string" || dir.length === 0) {
        fingerprints.push({ url, dir, fingerprint: stubFingerprint(dir), dependencies: stubDependencies(dir), artifactVersion: CURRENT_ARTIFACT_VERSION });
        continue;
      }

      const exists = await access(dir).then(() => true, () => false);
      if (!exists) {
        fingerprints.push({ url, dir, fingerprint: stubFingerprint(dir), dependencies: stubDependencies(dir), artifactVersion: CURRENT_ARTIFACT_VERSION });
        continue;
      }

      // exit 1 == "no ecosystem detected" but still valid JSON → allow non-zero.
      const argv = ["bash", FINGERPRINT_SH, dir, "--format", "json"];
      if (deep) argv.push("--deep");
      const { stdout } = await runArgv(argv, {
        timeoutMs: 120000,
        allowNonZero: true,
      });
      // 0065/A3: opt into the bounded submodule walk 0032/D3 built. It was gated
      // behind a flag NO caller ever passed, so a multi-module repo with no ROOT
      // manifest (multi-repo-npm declares deps only in repo-a/ and repo-b/)
      // fingerprinted with ZERO dependencies — and every consumer reasoning from
      // the dep list was blind to it. Same walk `commands.resolveDatasource` uses.
      const { dependencies } = await extractManifestDependencies(dir, { recurseSubmodules: true });
      fingerprints.push({ url, dir, fingerprint: parseReport(stdout, dir), dependencies, artifactVersion: CURRENT_ARTIFACT_VERSION });
    }
    // Defensive read path (0019/D1): entries already sitting in the channel
    // (e.g. seeded from an older on-disk artifact) are normalized through the
    // migration chain before merging, so pre-`dependencies` shapes never reach
    // downstream consumers.
    const previous = Array.isArray(state[params.into]) ? state[params.into].map(normalizeFingerprintEntry) : [];
    return { [params.into]: [...previous, ...fingerprints] };
  };
}
