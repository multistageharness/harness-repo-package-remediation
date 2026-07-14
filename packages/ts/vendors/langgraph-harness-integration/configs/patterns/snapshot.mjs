/**
 * commands.repoSnapshot — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): snapshot each cloned repo
 * into a per-repo file inventory (`langgraph-flow.md` step-8-style; change
 * records 0008 + 0009). Reads the `clone_results` channel emitted by
 * `commands.gitClone` (each `{ dir, url, cloned|existed|mocked }`), builds the
 * `.snapshot.json` contract per repo, and atomically WRITES one
 * `<out_dir>/<repo>.<name_suffix>` file per repo (the 0008/D2 artifact;
 * `name_suffix` defaults to `snapshot.json`, and langgraph-flow.md's step 9 in
 * the main repo-remediation.yaml flow sets `repo.json` → `<reponame>.repo.json`).
 * It also
 * emits a flat `snapshots` array — one `{ url, dir, repo, namespace, path,
 * written, fileCount, snapshot }` per repo — into the `into` channel so the
 * render leg can summarize the run.
 *
 * Phase namespace (change record 0029/A1): an optional `namespace` param
 * (alias `label`; `namespace` wins when both are given) names WHICH PHASE of
 * the run the snapshot captures — `initial` | `build` | `test` | …. When set,
 * the artifact lands in a NAMESPACED SUB-DIR — `<out_dir>/<namespace>/
 * <repo>.<name_suffix>` — so two phases' snapshots of the same repo never
 * collide and diff pairwise (initial→build→test); when omitted the legacy flat
 * `<out_dir>/<repo>.<name_suffix>` path is kept (the pre-0029 contract the
 * repo-snapshot.yaml flow still uses) while the DOCUMENT still self-identifies
 * via the tool-stamped `namespace: "initial"` default.
 *
 * Engine (0009/D4): the vendored, dependency-free **mjs** tool
 * (`harness-repo-package-remediation/vendors/tools-repo-filesystem-snapshots/packages/mjs/index.mjs`),
 * imported IN-PROCESS through the pack's single cross-vendor bridge
 * (`src/snapshot-lib.mjs`) — no per-repo subprocess spawn at the seam. The only
 * subprocess is the tool's fixed-argv `git ls-files -z` call (argv list, shell
 * injection structurally impossible — security rule 4); a non-git tree falls
 * back to a filtered fs walk inside the tool.
 *
 * Determinism: `generatedAt` is stamped HERE (the caller), not inside the tool —
 * so the library never reads the clock and snapshots stay pinnable in tests.
 *
 * Mock seam (offline acceptance contract): under `ctx.options.mock` — or for any
 * entry the clone stage marked `mocked` or whose `dir` is absent on disk — the
 * atom writes a deterministic STUB snapshot with NO git subprocess and NO
 * filesystem READ (it still writes the stub artifact, like the renderReport leg
 * writes under mock). Per change record 0014/A1 the stub is a small
 * REPRESENTATIVE populated inventory (not an empty map) so a default mock run
 * still emits the real `<basename>:[paths]` shape. Reaches no provider SDK; any credentials
 * env-only. Honors `ctx.options.dryRun` (skips the write, marks `written:false`).
 *
 * Trust boundary: this mapping module lives under `configs/patterns/` (satisfied);
 * its relative imports of `../../src/sdk.mjs` (the vendored SDK's writeFileAtomic)
 * and `../../src/snapshot-lib.mjs` (the snapshot tool's build/stub shaping) both
 * resolve inside the pack. Those two `src/` bridges are the only sites that reach
 * across a vendor boundary — the pattern file never does.
 */

import { access } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

import { writeFileAtomic } from "../../src/sdk.mjs";
// Snapshot shaping (build + stub) is OWNED by the tools-repo-filesystem-snapshots
// tool, bridged through the pack's single cross-vendor import site.
import { buildSnapshot, stubSnapshot } from "../../src/snapshot-lib.mjs";

export const meta = {
  name: "commands.repoSnapshot",
  category: "commands",
  summary: "Snapshot each cloned repo dir (mjs file-inventory tool, in-process, mock-aware) → one <repo>.snapshot.json per repo + snapshots channel.",
  params: {
    type: "object",
    required: ["clones_from", "out_dir", "into"],
    properties: {
      clones_from: { type: "string", minLength: 1 },
      out_dir: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
      // Optional per-repo filename suffix — `<repo>.<name_suffix>`. Defaults to
      // `snapshot.json` (record 0014/D1: the singular `.snapshot.json` the
      // repo-snapshot.yaml flow writes). langgraph-flow.md step 9 in the main
      // repo-remediation.yaml flow sets `repo.json` → `<reponame>.repo.json`.
      name_suffix: { type: "string", minLength: 1 },
      // Optional run-phase namespace (0029/A1) — `initial` | `build` | `test` |
      // …. When set, artifacts land under `<out_dir>/<namespace>/` and every
      // snapshots[] entry + document carries it. `label` is the accepted alias
      // (the record's `namespace|label`); `namespace` wins when both are given.
      namespace: { type: "string", minLength: 1 },
      label: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

export function repoSnapshot(params, ctx) {
  return async (state) => {
    const clones = Array.isArray(state[params.clones_from]) ? state[params.clones_from] : [];

    const outDirRel = params.out_dir;
    const outDir = isAbsolute(outDirRel) ? outDirRel : resolve(ctx.options.baseDir, outDirRel);
    const nameSuffix =
      typeof params.name_suffix === "string" && params.name_suffix.length > 0
        ? params.name_suffix
        : "snapshot.json";
    // 0029/A1: the phase axis. `namespace` wins over its `label` alias; absent
    // both, the tool stamps its `initial` default and the path stays flat.
    const namespace =
      typeof params.namespace === "string" && params.namespace.length > 0
        ? params.namespace
        : typeof params.label === "string" && params.label.length > 0
          ? params.label
          : null;

    const snapshots = [];
    for (const clone of clones) {
      const url = clone?.url ?? null;
      const dir = clone?.dir ?? null;
      const repo = typeof dir === "string" && dir.length > 0 ? basename(dir) : "unknown";
      // Caller-stamped timestamp — the tool never reads the clock (determinism).
      const generatedAt = new Date().toISOString();

      let doc;
      // Stub under mock, for mock-cloned entries, or when there is no real dir.
      if (ctx.options.mock || clone?.mocked === true || typeof dir !== "string" || dir.length === 0) {
        doc = stubSnapshot({ root: dir, repo, generatedAt, namespace });
      } else {
        const exists = await access(dir).then(() => true, () => false);
        doc = exists
          ? await buildSnapshot({ root: dir, repo, generatedAt, namespace })
          : stubSnapshot({ root: dir, repo, generatedAt, namespace });
      }

      // 0029/A1 path disambiguation: an explicit phase gets its own sub-dir so
      // a second invocation (build/test) never overwrites the first (initial).
      const target = namespace
        ? join(outDir, namespace, `${repo}.${nameSuffix}`)
        : join(outDir, `${repo}.${nameSuffix}`);
      const rendered = `${JSON.stringify(doc, null, 2)}\n`;

      if (ctx.options.dryRun) {
        ctx.emit?.("node.end", { note: `dry_run: skipped snapshot write to ${target}` });
        snapshots.push({ url, dir, repo, namespace: doc.namespace, path: target, written: false, dry_run: true, fileCount: doc.fileCount, snapshot: doc });
        continue;
      }

      await writeFileAtomic(target, rendered);
      snapshots.push({
        url,
        dir,
        repo,
        namespace: doc.namespace,
        path: target,
        written: true,
        bytes: Buffer.byteLength(rendered),
        fileCount: doc.fileCount,
        snapshot: doc,
      });
    }

    return { [params.into]: snapshots };
  };
}
