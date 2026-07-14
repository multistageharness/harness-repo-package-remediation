/**
 * commands.venvSetup — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): provision the isolated
 * Python virtualenv the step-9 python lane's tools run from (record 0018/D1;
 * adopted by 0019 phase 3).
 *
 * On a real (`MOCK=false`) run: create the TOOLING venv and `pip install` the
 * python-lane tools (`deptry`, `pipdeptree`) into it when missing — so
 * `extract_python` invokes them from the venv rather than the host interpreter
 * (the harness's pinned dependency contract covers the harness, not tools run
 * against a cloned repo's throwaway env). Idempotent within a run: parallel
 * Send branches re-enter this node and find the marker files already present.
 *
 * The `pip install` step DEGRADES on failure rather than failing the flow: these
 * tools are OPTIONAL analysis tooling, and the most common failure is the local
 * package index (pip is configured to point at it) being down or the host being
 * offline — neither of which should detonate a whole multi-repo remediation. On
 * an install failure the node records `{ skipped: "tooling-install-failed",
 * installFailed, reason }` and returns; the extractor (`commands.depgraphExtract`)
 * then probes each tool IF-present-ELSE-SKIP and records its own downgrade. This
 * is the same "the lane degrades, never fails" contract already honored for a
 * missing `python3` or a missing clone dir.
 *
 * Venv topology (revises 0026/A4, which supersedes 0018/D1's run-global
 * `<session>/.venv`): the tooling venv is PER-REPO and lives OUTSIDE the clone
 * at `<venv_root>/<clone-basename>/.venv-deptry`, keyed off the branch's
 * `clone_from` entry (`fingerprint_item.dir`). It is tooling-only — the repo's
 * own dependencies land in `<clone>/.venv`, provisioned by the step-10 install
 * playbook — which is what keeps `pipdeptree`'s view of the install env
 * meaningful and `deptry`/`pipdeptree` out of the analyzed closure. The legacy
 * `venv_path` param remains for a run-global tooling venv when no `clone_from`
 * is wired.
 *
 * 0026/A4 placed this venv IN the clone and argued it was safe because install
 * and step 11 run after `snapshot` (0026/A1 ordering). That covered the snapshot
 * but not the BUILD, which also runs after and packages the tree: a python sdist
 * includes whatever the target repo's .gitignore does not exclude, so a repo
 * ignoring `.venv/` but not `.venv-deptry/` tarred the whole tooling venv into
 * its own sdist and the build died extracting an absolute `bin/python3.x` symlink
 * back out (tarfile.AbsoluteLinkError). Hence: the harness does not write into a
 * tree it is going to build. Only the install venv (`.venv`, conventionally
 * ignored, and now bypassed by `build --wheel`) still lands in the clone.
 *
 * Under `--mock` (default) it is a deterministic no-op returning
 * `{ venv: null, mocked: true }` — no fs write, no subprocess, no network —
 * keeping the offline acceptance contract. venv creation and pip install
 * require network, so they run only outside the default verify gate
 * (security rule 8).
 *
 * Lifecycle note (deviation from 0018/D1's "torn down at run end", recorded
 * in the plan): the venv is left in place under `.harness/` (git-ignored,
 * disposable). Step-9 fan-out runs N parallel subgraph instances sharing one
 * venv, so an in-flow teardown node would race its siblings; delete
 * `.harness/.venv` (or point $VENV_PATH elsewhere) for a fresh env.
 *
 * Subprocesses are argv lists via the SDK's runArgv (security rule 4), each
 * with a bounded timeout (platform rule 4). POSIX venv layout (`bin/`) — the
 * harness targets darwin/linux.
 */

import { access } from "node:fs/promises";
import { basename, delimiter, isAbsolute, join, resolve, sep } from "node:path";

import { runArgv } from "../../src/sdk.mjs";

export const meta = {
  name: "commands.venvSetup",
  category: "commands",
  summary: "Provision an isolated Python venv ($VENV_PATH) + install the python-lane depgraph tools (deptry, pipdeptree); deterministic no-op under mock.",
  params: {
    type: "object",
    required: ["into"],
    properties: {
      // 0026/A4: channel holding the branch's fingerprint entry ({ url, dir,
      // … }) — the tooling venv is derived PER-REPO, now as
      // `<venv_root>/<basename(dir)>/<venv_dirname>` (outside the clone).
      clone_from: { type: "string" },
      // Root the per-repo tooling venvs are provisioned under; resolved against
      // the flow dir when relative. Kept OUT of the clone so the tree the build
      // stage packages stays clean — see the topology note in the header.
      venv_root: { type: "string" },
      // The tooling venv's leaf directory name. `.venv-deptry` is a NON-DEFAULT
      // name for deptry's exclude list; the step-11 deptry argv still carries an
      // explicit `--extend-exclude` for it, which is now belt-and-braces (the
      // venv no longer sits in the scanned tree) and costs nothing.
      venv_dirname: { type: "string" },
      // Legacy run-global path ($VENV_PATH) — used only when `clone_from` is
      // not wired; resolved against the flow dir; default under .harness/.
      venv_path: { type: "string" },
      // tools installed into the venv (default: the python-lane pair)
      packages: { type: "array", items: { type: "string" } },
      into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

const exists = (path) => access(path).then(() => true, () => false);

/** Trim a subprocess/Error down to a single concise line for a recorded skip. */
function shortError(err) {
  const msg = typeof err?.message === "string" ? err.message : String(err);
  return msg.split("\n", 1)[0].slice(0, 300);
}

async function defaultProbe(bin) {
  if (bin.includes(sep) || bin.includes("/")) return exists(bin);
  for (const d of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    if (await exists(join(d, bin))) return true;
  }
  return false;
}

/** Test seam: build the factory over an injected argv runner + CLI probe. */
export function _venvSetupWith({ runner = runArgv, probe = defaultProbe } = {}) {
  return function venvSetupFactory(params, ctx) {
    // The step-9 fan-out invokes this node once per parallel Send branch, all
    // sharing this single compiled factory. Concurrent `python -m venv` /
    // `pip install` into the same path collide, so provisioning is serialized
    // through one promise chain — later branches re-check the marker files
    // after the earlier branch finishes and no-op.
    //
    // 0026/A4 note: with per-repo venv paths (`clone_from`) branches no longer
    // contend, so this lock's original REASON is gone — it survives as cheap,
    // correct serialization (recorded in 0026/A4; a later record may relax it
    // to a per-path lock).
    let provisionChain = Promise.resolve();
    return async (state) => {
      if (ctx.options.mock) {
        return { [params.into]: { venv: null, mocked: true } };
      }

      // Per-repo tooling venv, provisioned OUTSIDE the clone (revises 0026/A4,
      // which placed it at `<clone>/.venv-deptry`). A branch whose clone failed
      // (no dir on disk) degrades to a recorded skip — the extractor lane records
      // its own clone-failed skip right after.
      //
      // Why it moved: an in-clone venv dirties the very tree the build stage later
      // packages. 0026/A4 reasoned this through for SNAPSHOT safety (install and
      // step 11 run after `snapshot`) but the build stage also runs after, and a
      // python backend's sdist includes whatever the target repo's .gitignore does
      // not exclude. A repo ignoring `.venv/` but not `.venv-deptry/` swept the
      // entire tooling venv into its tarball — 653 files, 4.2MB, including an
      // absolute symlink `bin/python3.14 -> /opt/homebrew/…` that makes the build
      // fail while extracting its OWN sdist (tarfile.AbsoluteLinkError, PEP 706
      // data filter). The harness must not depend on each target repo ignoring a
      // directory named after a harness tool; it should not be writing into the
      // tree it is about to build at all.
      //
      // Nothing required it to be in-clone: deptry takes the clone as an argv scan
      // target (see depgraphCommands in src/ecosystem-registry.mjs), so it scans
      // the clone perfectly well from outside it. Keyed by clone basename to keep
      // the per-repo isolation 0026/A4 bought (branches never contend on a path).
      let venvPath;
      if (params.clone_from) {
        const entry = state?.[params.clone_from] ?? {};
        const dir = typeof entry.dir === "string" && entry.dir.length > 0 ? entry.dir : null;
        if (!dir || !(await exists(dir))) {
          return { [params.into]: { venv: null, skipped: "no-clone-dir" } };
        }
        const rootRel = params.venv_root ?? "../../.harness/venvs";
        const root = isAbsolute(rootRel) ? rootRel : resolve(ctx.options.baseDir, rootRel);
        venvPath = resolve(root, basename(dir), params.venv_dirname ?? ".venv-deptry");
      } else {
        const venvRel = params.venv_path ?? "../../.harness/.venv";
        venvPath = isAbsolute(venvRel) ? venvRel : resolve(ctx.options.baseDir, venvRel);
      }
      const bin = join(venvPath, "bin");

      // IF-CLI-present-ELSE-SKIP: no python → the lane degrades, never fails.
      const python = (await probe("python3")) ? "python3" : (await probe("python")) ? "python" : null;
      if (!python) {
        return { [params.into]: { venv: null, skipped: "python3", reason: "not on PATH" } };
      }

      const provision = async () => {
        let created = false;
        if (!(await exists(join(venvPath, "pyvenv.cfg")))) {
          await runner([python, "-m", "venv", venvPath], { timeoutMs: 120000 });
          created = true;
        }

        const packages = Array.isArray(params.packages) && params.packages.length > 0 ? params.packages : ["deptry", "pipdeptree"];
        const missing = [];
        for (const pkg of packages) {
          if (!(await exists(join(bin, pkg)))) missing.push(pkg);
        }
        let installed = [];
        let installFailed = null;
        if (missing.length > 0) {
          try {
            await runner([join(bin, "pip"), "install", ...missing], { timeoutMs: 600000 });
            installed = missing;
          } catch (err) {
            // Optional python-lane tooling: an install failure (local index down,
            // offline host) DEGRADES this lane rather than failing the flow. The
            // venv itself was still created; the extractor probes each tool
            // IF-present-ELSE-SKIP and records its own downgrade.
            installFailed = { packages: missing, reason: shortError(err) };
          }
        }
        return { created, installed, installFailed };
      };

      // Chain on settle (fulfilled OR rejected) so one branch's failure never
      // poisons its siblings — each retries its own provision pass.
      const result = provisionChain.then(provision, provision);
      provisionChain = result.then(
        () => {},
        () => {},
      );
      const { created, installed, installFailed } = await result;

      const out = { venv: venvPath, bin, created, installed };
      if (installFailed) {
        out.skipped = "tooling-install-failed";
        out.installFailed = installFailed.packages;
        out.reason = installFailed.reason;
      }
      return { [params.into]: out };
    };
  };
}

export const venvSetup = _venvSetupWith({});
