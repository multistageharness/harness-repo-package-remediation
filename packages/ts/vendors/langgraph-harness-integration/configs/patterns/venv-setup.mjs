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
 * Venv topology (change record 0026/A4, supersedes 0018/D1's run-global
 * `<session>/.venv`): the tooling venv is PER-REPO and lives INSIDE the clone
 * at `<clone>/.venv-deptry`, derived from the branch's `clone_from` entry
 * (`fingerprint_item.dir`). It is tooling-only — the repo's own dependencies
 * land in the sibling `<clone>/.venv` provisioned by the step-10 install
 * playbook — which is exactly what keeps `pipdeptree`'s view of the install
 * env meaningful and `deptry`/`pipdeptree` out of the analyzed closure. The
 * legacy `venv_path` param remains for a run-global tooling venv when no
 * `clone_from` is wired. Both venvs dirty the clone — safe ONLY because
 * install and step 11 run after `snapshot` (0026/A1 ordering).
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
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";

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
      // … }) — the tooling venv is derived PER-REPO as `<dir>/<venv_dirname>`.
      clone_from: { type: "string" },
      // The in-clone tooling venv directory name. `.venv-deptry` is a
      // NON-DEFAULT name for deptry's exclude list — the step-11 deptry argv
      // carries an explicit `--extend-exclude` for it (0026/A4 open item).
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

      // 0026/A4: per-repo tooling venv INSIDE the clone. A branch whose clone
      // failed (no dir on disk) degrades to a recorded skip — the extractor
      // lane records its own clone-failed skip right after.
      let venvPath;
      if (params.clone_from) {
        const entry = state?.[params.clone_from] ?? {};
        const dir = typeof entry.dir === "string" && entry.dir.length > 0 ? entry.dir : null;
        if (!dir || !(await exists(dir))) {
          return { [params.into]: { venv: null, skipped: "no-clone-dir" } };
        }
        venvPath = resolve(dir, params.venv_dirname ?? ".venv-deptry");
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
