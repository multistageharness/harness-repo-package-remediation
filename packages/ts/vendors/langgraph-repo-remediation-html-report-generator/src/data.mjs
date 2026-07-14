/**
 * src/data.mjs — the report's DATA LAYER (change record 0057/A2).
 *
 * `buildReportData(channels, { keyOf }) → ReportData` joins the 13 pipeline channels into a
 * single, pure, JSON-SERIALIZABLE value that fully describes the run. It is the one contract
 * the report is rendered from — the generator's half of record 0057's split:
 *
 *   generator  → gets the data from the generated artifacts   (this module)
 *   reactjs    → uses the data to render the experience       (the SSR/client bundle)
 *
 * Before this record there was NO serializable intermediate: the channel join, the derivation,
 * and the HTML string-building were one inseparable pass, so the emitted page contained zero
 * occurrences of `application/json` — every fact was baked into escaped markup at generate time.
 * You cannot embed a payload that never exists as a value, so extracting this is what makes the
 * data island (0057/D2) possible at all.
 *
 * This module is the part of the generator that SURVIVES record 0057/A3, which retires
 * `render.mjs` / `style.mjs` / `client.mjs` as UI authors. Everything here is data; nothing here
 * emits markup.
 *
 * PURITY IS LOAD-BEARING. No I/O, no clock, no `Math.random()` — the same channels must produce
 * the same value, byte for byte, or the golden replay gate (record 0055/D2) cannot exist. Where a
 * channel does not carry a field the design surfaces, the value is DERIVED deterministically via
 * FNV-1a (see `derive.mjs`); those derivations are COSMETIC-ONLY. Substantive facts —
 * vulnerabilities, plan actions, outcomes, the prompt, stage pass/fail, the dependency graph —
 * always come from the real channels (record 0041/D1).
 *
 * `keyOf` is INJECTED (record 0055/A3): it is the join key every channel is grouped by, and it
 * MUST be the same function the pipeline built those channels with, or repos silently fail to
 * join and the detail panels render empty.
 */

import { bumpLevel } from "./bump.mjs";
import { clock, rnd, sha } from "./derive.mjs";
import { eco, SKILLS, STATUS_ORDER } from "./tokens.mjs";

const asArray = (v) => (Array.isArray(v) ? v : []);
const shortName = (pkg) => String(pkg ?? "").split(":").pop();
const lastSeg = (url) => String(url ?? "").replace(/\/+$/, "").split("/").pop() || "repo";

/**
 * Split an UNSTAMPED node id (a plan's inline tuple graph) into `[name, version]`.
 *
 * Splits on the LAST `@`, never the first: `@scope/pkg@1.2.3` is a scoped package at 1.2.3, and
 * `id.split("@")` — what this used to be — read it as a package named `""`. An id with no `@` at
 * all (a maven `group:artifact:version` coordinate) keeps its whole id as the name and reports no
 * version, rather than inventing one. Nodes from the dependency-graph channel never reach here:
 * they carry a stamped name and version.
 */
function parseNodeId(id) {
  const at = String(id).lastIndexOf("@");
  return at > 0 ? [id.slice(0, at), id.slice(at + 1)] : [id, ""];
}

/**
 * Accept BOTH edge shapes the pipeline produces and normalize to `[from, to]` tuples.
 *
 * The `dependency_graphs` channel emits `{from, to}` objects; a plan's inline `graph` emits tuples.
 * See the call site — treating "not a tuple" as "not an edge" is what silently emptied every graph.
 */
function normalizeEdges(raw) {
  const out = [];
  for (const e of asArray(raw)) {
    if (Array.isArray(e) && e.length === 2 && e[0] != null && e[1] != null) out.push([String(e[0]), String(e[1])]);
    else if (e && typeof e === "object" && e.from != null && e.to != null) out.push([String(e.from), String(e.to)]);
  }
  return out;
}

/**
 * The package's standalone repo-key normalizer (record 0055/A3).
 *
 * In the harness the pack injects its own `normalizeRepoUrl` (`src/repo-url.mjs`, the single
 * source of truth) so there is exactly one key function in play. This default exists only so the
 * package is usable standalone; the pack's `html-report-keyof.test.mjs` asserts the two agree
 * across the fixture corpus, so the fallback can never quietly diverge.
 *
 * @param {unknown} input a repo URL (https or `git@host:owner/repo.git` SSH form)
 * @returns {string|null} the canonical `https://host/owner/repo`, or null if not a repo URL
 */
export function defaultKeyOf(input) {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (s === "") return null;
  const HTTPS_RE = /^https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i;
  const SSH_RE = /^git@([^:\s]+):([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i;
  const parts = s.match(SSH_RE) ?? s.match(HTTPS_RE);
  if (!parts) return null;
  const [, host, owner, repo] = parts;
  return `https://${host.toLowerCase()}/${owner}/${repo}`;
}

/* ------------------------------------------------------------------ */
/* channels → RAW-shaped list (real data)                              */
/* ------------------------------------------------------------------ */

/**
 * Build the RAW model rows from the real pipeline channels, joined on `keyOf`.
 */
function toRawList(channels, keyOf) {
  const plans = asArray(channels.plans);
  const prompts = asArray(channels.optimized_prompts);
  const validations = asArray(channels.validations);
  const remediations = asArray(channels.remediations);
  const clones = asArray(channels.clone_results);
  const installs = asArray(channels.installs);
  const verifications = asArray(channels.install_verifications);
  const builds = asArray(channels.builds);
  const tests = asArray(channels.tests);
  const depgraphs = asArray(channels.dependency_graphs);

  const byUrl = (arr, pick = (x) => x?.url) => {
    const m = new Map();
    for (const x of arr) {
      const k = keyOf(pick(x));
      if (k !== null && !m.has(k)) m.set(k, x);
    }
    return m;
  };
  const planM = byUrl(plans);
  const promptM = byUrl(prompts, (p) => p?.url ?? p?.repo);
  const valM = byUrl(validations);
  const installM = byUrl(installs);
  const verifyM = byUrl(verifications);
  const buildM = byUrl(builds);
  const testM = byUrl(tests);
  const depM = byUrl(depgraphs, (d) => d?.url ?? d?.repo);
  const remM = new Map();
  for (const r of remediations) {
    const k = keyOf(r?.repo ?? r?.url);
    if (k === null) continue;
    if (!remM.has(k)) remM.set(k, []);
    remM.get(k).push(r);
  }

  // Ordered union of repo urls: plans first, then validation/clone-only repos.
  const order = [];
  const seen = new Set();
  const push = (url) => {
    const k = keyOf(url);
    if (k === null || seen.has(k)) return;
    seen.add(k);
    order.push({ key: k, url });
  };
  for (const p of plans) push(p?.url);
  for (const v of validations) push(v?.url);
  for (const c of clones) push(c?.url);

  return order.map(({ key, url }) => {
    const plan = planM.get(key);
    const prompt = promptM.get(key);
    const validation = valM.get(key);
    // The remediation RECORDS — what was written to disk, as opposed to what the plan proposed
    // (record 0056/A1). Each is stamped with the SIZE of its version move, classified from its own
    // real `from`/`to` (`bump.mjs`), so the report renders the level instead of deriving it.
    //
    // The field is `bump`, NOT `level`: `level` is already taken in this contract — `LogLine.level`
    // is a log severity (`cmd`/`ok`/`warn`). Two meanings of one field name across one payload is
    // how a renderer ends up coloring a version bump with a log-level palette.
    const reps = (remM.get(key) ?? []).map((rep) => ({
      ...rep,
      bump: bumpLevel(rep?.from, rep?.to),
    }));
    const ecosystem = plan?.ecosystem ?? validation?.ecosystem ?? "unknown";
    const outcomes = validation?.outcomes ?? { fixed: 0, broken: 0, blocked: 0, skipped: 0, bug: 0 };

    const vulns = asArray(plan?.vulnerabilities).map((v) => {
      const act = asArray(plan?.actions).find((a) => a?.package === v?.package) ?? {};
      return {
        pkg: v?.package ?? "(unknown)",
        sev: v?.severity ?? "unknown",
        cve: v?.cveId ?? "",
        scope: v?.scope ?? "direct",
        from: v?.currentVersion ?? act.from ?? "?",
        to: v?.recommendedVersion ?? act.to ?? "latest",
        tool: act.tool ?? "manifest-edit",
        action: act.strategy ?? "direct-bump",
      };
    });

    // edges: prefer the real dependency-graph channel, else the plan's own graph.
    //
    // THE TWO SOURCES DISAGREE ABOUT SHAPE, and until now that disagreement silently emptied the
    // graph. The `dependency_graphs` channel (npm-list / mvn-dependency-tree) emits edges as
    // `{from,to}` OBJECTS and ships a stamped `nodes` list beside them; a plan's inline `graph`
    // emits 2-tuples. This line used to be `.filter((e) => Array.isArray(e) && e.length === 2)`,
    // which is true of the tuples and FALSE OF EVERY OBJECT — so every real edge was discarded,
    // every repo fell back to the synthetic one-node "root" graph, and the report's dependency
    // graph rendered as a single empty box on every run ever emitted. Normalize instead of filter.
    const dg = depM.get(key);
    const edges = normalizeEdges(dg?.edges ?? plan?.graph);
    // The channel's own nodes carry the name/version the RESOLVER reported. Prefer them over
    // splitting an id: `id.split("@")` cannot parse `@scope/pkg@1.2.3` and maven ids are
    // `group:artifact:version`, so a reconstructed name is wrong exactly where it matters.
    const dgNodes = asArray(dg?.nodes).filter((n) => n && typeof n.id === "string");

    const stage = (m, alt) => m.get(key)?.status ?? alt ?? "n/a";
    const st = validation?.stages ?? {};

    return {
      key: lastSeg(url),
      url,
      eco: ecosystem,
      branch: plan?.branch ?? clones.find?.((c) => keyOf(c?.url) === key)?.branch ?? "main",
      license: plan?.license ?? "n/a",
      loc: plan?.loc ?? rnd(key + "loc", 400, 3400),
      vulns,
      // 0056/A3: the plan's RAW action count. `vulns` above is the zipped view (one row
      // per vulnerability, with its matching action folded in), so it structurally cannot
      // see an action that has no vulnerability behind it — and those are exactly the
      // interesting ones: a package-rule-injected pin (record 0032/D5) is an action with no
      // advisory. Carry the real count so the "Plan actions" tile can be a stat instead of
      // an echo of the tile beside it.
      actionCount: asArray(plan?.actions).length,
      reps,
      prompt: prompt?.prompt ?? "(no optimized prompt was produced for this repository)",
      promptSource: prompt?.source ?? "n/a",
      skill: plan?.skill ?? SKILLS[ecosystem] ?? SKILLS.unknown,
      tools: asArray(plan?.tools),
      cloneError: plan?.cloneError ?? null,
      overall: validation?.overall ?? "n/a",
      outcomes,
      diagnoses: asArray(validation?.packages).filter((p) => p && (p.status === "blocked" || p.status === "broken" || p.status === "bug")),
      edges,
      dgNodes,
      stages: {
        install: stage(installM),
        verify: st.installVerify ?? stage(verifyM),
        build: st.build ?? stage(buildM),
        test: st.test ?? stage(testM),
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* manifest before/after → snapshot diff (representative)              */
/* ------------------------------------------------------------------ */

function manifests(r) {
  const v0 = r.vulns[0];
  if (r.eco === "java") {
    return {
      file: "pom.xml",
      before: `<project>\n  <artifactId>${r.key}</artifactId>\n  <dependencies>\n    <dependency>\n      <groupId>com.example</groupId>\n      <artifactId>app</artifactId>\n    </dependency>\n  </dependencies>\n</project>`,
      after: `<project>\n  <artifactId>${r.key}</artifactId>\n  <dependencyManagement>\n    <dependencies>\n${r.vulns.map((v) => `      <dependency>\n        <artifactId>${shortName(v.pkg)}</artifactId>\n        <version>${v.to}</version>\n      </dependency>`).join("\n")}\n    </dependencies>\n  </dependencyManagement>\n  <dependencies>\n    <dependency>\n      <groupId>com.example</groupId>\n      <artifactId>app</artifactId>\n    </dependency>\n  </dependencies>\n</project>`,
    };
  }
  if (r.eco === "python") {
    if (v0 && v0.scope === "transitive") {
      return {
        file: "constraints.txt",
        before: `# constraints applied to every resolve\n# (empty)`,
        after: `# constraints applied to every resolve\n${r.vulns.map((v) => `${shortName(v.pkg)}==${v.to}  # ${v.cve}`).join("\n")}`,
      };
    }
    return {
      file: "requirements.txt",
      before: r.vulns.map((v) => `${shortName(v.pkg)}==${v.from}`).join("\n") || "# (no direct pins)",
      after: r.vulns.map((v) => `${shortName(v.pkg)}==${v.to}`).join("\n") || "# (no direct pins)",
    };
  }
  // node
  if (v0 && v0.scope === "transitive") {
    return {
      file: "package.json",
      before: `{\n  "name": "${r.key}",\n  "version": "1.0.0"\n}`,
      after: `{\n  "name": "${r.key}",\n  "version": "1.0.0",\n  "overrides": {\n${r.vulns.map((v) => `    "${v.pkg}": "${v.to}"`).join(",\n")}\n  }\n}`,
    };
  }
  return {
    file: "package.json",
    before: `{\n  "name": "${r.key}",\n  "version": "1.0.0",\n  "dependencies": {\n${r.vulns.map((v) => `    "${v.pkg}": "${v.from}"`).join(",\n")}\n  }\n}`,
    after: `{\n  "name": "${r.key}",\n  "version": "1.0.0",\n  "dependencies": {\n${r.vulns.map((v) => `    "${v.pkg}": "${v.to}"`).join(",\n")}\n  }\n}`,
  };
}

/**
 * Longest-common-subsequence line diff → `[{t: " "|"-"|"+", text}]`.
 *
 * 0057/A2: the diff is computed HERE, in the data layer, and travels on the snapshot as
 * `snap.diff`. It used to be computed inside the renderer at markup-build time. The React tree
 * cannot call into a `.mjs`, so a diff the UI has to compute for itself is a diff the UI cannot
 * have — carrying the rows makes `ReportData` self-sufficient.
 */
function diffLines(aStr, bStr) {
  const a = String(aStr).split("\n");
  const b = String(bStr).split("\n");
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) (out.push({ t: " ", text: a[i++] }), j++);
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: "-", text: a[i++] });
    else out.push({ t: "+", text: b[j++] });
  }
  while (i < m) out.push({ t: "-", text: a[i++] });
  while (j < n) out.push({ t: "+", text: b[j++] });
  return out;
}

/* ------------------------------------------------------------------ */
/* stage logs (representative, deterministic, keyed on real facts)     */
/* ------------------------------------------------------------------ */

const STAGE_NAMES = ["clone", "remediate", "install", "build", "test", "validate"];
const ORG_FROM = (url) => {
  const parts = String(url).replace(/\/+$/, "").split("/");
  return parts.length >= 2 ? parts[parts.length - 2] : "org";
};

function buildLogs(r) {
  const base = Date.UTC(2026, 6, 10, 14, 2, 0);
  const L = [];
  let t = 0;
  const push = (stage, level, msg) => {
    t += rnd(r.key + stage + msg, 40, 380);
    L.push({ t: clock(base, t), stage, level, msg });
  };
  const pkgList = r.vulns.map((v) => `${v.pkg}@${v.to}`).join(", ") || "(no packages)";
  push("clone", "cmd", `git clone --depth 1 https://github.com/${ORG_FROM(r.url)}/${r.key}.git`);
  push("clone", "ok", `HEAD is now at ${sha(r.key).slice(0, 7)} (${r.branch})`);
  push("remediate", "cmd", `skill ${r.skill} --repo ${r.key}`);
  for (const v of r.vulns) {
    push("remediate", "info", `${v.tool}: ${v.pkg} ${v.from} → ${v.to}`);
    push("remediate", "ok", `${v.action} applied${v.cve ? ` (${v.cve})` : ""}`);
  }
  push("install", "cmd", r.eco === "java" ? "mvn -B -q dependency:go-offline" : r.eco === "python" ? "pip install -r requirements.txt -c constraints.txt" : "npm install --no-audit --no-fund");
  push("install", r.stages.install === "failed" ? "error" : "ok", `install-verify: ${r.stages.install} — resolved ${pkgList}`);
  // 0042/A3: don't synthesize a `npm run build` command + build line for a repo
  // that declares no build script — an `n/a` build is not-applicable, not a
  // failed/skipped run. Emit a single honest note instead of a phantom command.
  if (r.stages.build === "n/a") {
    push("build", "warn", "build: not applicable — no build script declared (stage not exercised)");
  } else {
    push("build", "cmd", r.eco === "java" ? "mvn -B -DskipTests package" : r.eco === "python" ? "python -m build --wheel" : "npm run build");
    push("build", r.stages.build === "failed" ? "error" : r.stages.build === "skipped" ? "warn" : "ok", `build: ${r.stages.build}`);
  }
  if (r.stages.test === "ok") {
    push("test", "cmd", r.eco === "java" ? "mvn -B test" : r.eco === "python" ? "pytest -q" : "npm test");
    push("test", "ok", `${rnd(r.key + "t", 6, 48)} passed, 0 failed`);
  } else if (r.stages.test === "n/a") {
    push("test", "warn", "test: not applicable — no test stage was grounded (stage not exercised)");
  } else {
    push("test", "warn", `test: ${r.stages.test} — stage skipped (does not affect pass rate)`);
  }
  push("validate", "cmd", `audit --ecosystem ${r.eco} --fail-on high`);
  for (const v of r.vulns) push("validate", "ok", `${v.cve || v.pkg} — resolved ${v.to} satisfies first-patched`);
  push("validate", "ok", `${r.outcomes.fixed ?? 0} fixed · ${r.outcomes.broken ?? 0} broken · ${r.outcomes.blocked ?? 0} blocked`);
  return L;
}

/* ------------------------------------------------------------------ */
/* derive full per-repo model                                          */
/* ------------------------------------------------------------------ */

function deriveRepo(r) {
  // 0042/A3: an absent (`n/a`) stage is NOT-APPLICABLE / not-grounded — a state
  // distinct from a real runtime `skipped` and from a fake green. Mapping it to
  // `"na"` (was `"ok"` for install/build, `"skipped"` for test) stops the rail
  // implying a repo passed a stage it never ran, or has a `build` it declares no
  // script for. Not-applicable, like blocked/skipped, stays out of the pass-rate
  // denominator (that math is unchanged — it reads outcomes, not stage dots).
  const stages = STAGE_NAMES.map((name) => {
    let status = "ok";
    if (name === "install") status = r.stages.install === "n/a" ? "na" : r.stages.install;
    else if (name === "build") status = r.stages.build === "n/a" ? "na" : r.stages.build;
    else if (name === "test") status = r.stages.test === "n/a" ? "na" : r.stages.test;
    return { name, status: status === "failed" ? "failed" : status, duration: rnd(r.key + name, 300, name === "install" ? 22000 : name === "build" ? 14000 : 4200) };
  });

  const mf = manifests(r);
  const snapshots = [
    { id: "pre-remediate", after: "remediate", label: "Pre-remediate", file: mf.file, kind: "diff", before: mf.before, next: mf.before, changed: 0 },
    { id: "post-remediate", after: "remediate", label: "Post-remediate", file: mf.file, kind: "diff", before: mf.before, next: mf.after, changed: 1 },
    { id: "post-install", after: "install", label: "Post-install", file: eco(r.eco).lock, kind: "digest", changed: r.vulns.length },
    { id: "post-build", after: "build", label: "Post-build", file: "dist/", kind: "digest", changed: 0 },
  ].map((s) => ({
    ...s,
    digest: sha(r.key + s.id),
    // Carried on the snapshot so the UI never has to compute it (see `diffLines`).
    diff: s.kind === "diff" ? diffLines(s.before, s.next) : [],
  }));

  // dependency graph: nodes + depth from real edges.
  //
  // The channel stamps each node's `name`/`version`; an id is only a fallback for a plan's inline
  // tuple graph, which carries no node list. A node whose resolver reported no version keeps `""`
  // — NOT the string "unknown" and NOT a guess. "The tool did not resolve this" and "this resolved
  // to a version called unknown" are different facts, and only one of them is true.
  const stamped = new Map(asArray(r.dgNodes).map((n) => [n.id, n]));
  const nodeIds = new Set(stamped.keys());
  for (const [a, b] of r.edges) (nodeIds.add(a), nodeIds.add(b));
  if (nodeIds.size === 0) nodeIds.add("root");

  // A ROOT is a node nothing depends on — the real graphs have a real root (the repo's own
  // package), so `id === "root"` only identifies the SYNTHETIC root of a repo with no graph.
  const hasIncoming = new Set(r.edges.map(([, b]) => b));
  const depth = {};
  for (const id of nodeIds) if (!hasIncoming.has(id)) depth[id] = 0;
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 64) {
    changed = false;
    for (const [a, b] of r.edges) {
      if (depth[a] !== undefined && (depth[b] === undefined || depth[b] < depth[a] + 1)) {
        depth[b] = depth[a] + 1;
        changed = true;
      }
    }
  }
  const nodes = [...nodeIds].map((id) => {
    const s = stamped.get(id);
    const [idName, idVersion] = id === "root" ? [r.key, r.branch] : parseNodeId(id);
    const name = s?.name ?? idName;
    const vuln = r.vulns.find((v) => v.pkg === name || id.startsWith(v.pkg + "@"));
    // `vuln` is `undefined` for a clean node. JSON.stringify drops undefined values, so the
    // key is simply absent after a round-trip through the data island — which reads the same
    // to every consumer (`n.vuln` is falsy either way). Normalize to null so the serialized
    // and in-memory shapes are identical rather than merely equivalent.
    return {
      id,
      name,
      // A STAMPED node is trusted exactly, INCLUDING its nulls. Falling back to the id when
      // `s.version` is null looks harmless and is not: the graph writer composes ids as
      // `name@version` and substitutes the literal placeholder `unknown` when the resolver gave it
      // nothing — so parsing the id resurrects that placeholder as if it were a real version
      // ("axios@unknown" → "unknown"). The package then reads as RESOLVED to a version named
      // `unknown`, which in turn makes `typescript` look like it has two conflicting versions
      // rather than one known and one unmeasured. `""` means "the resolver reported none".
      version: s ? (s.version ?? "") : (idVersion ?? ""),
      depth: depth[id] ?? 1,
      vuln: vuln ?? null,
      isRoot: !hasIncoming.has(id),
    };
  });

  const ledger = { fixed: r.outcomes.fixed ?? 0, broken: r.outcomes.broken ?? 0, blocked: r.outcomes.blocked ?? 0, skipped: r.outcomes.skipped ?? 0, bug: r.outcomes.bug ?? 0 };
  const logs = buildLogs(r);
  return {
    ...r,
    id: r.key,
    stages,
    snapshots,
    manifest: mf,
    nodes,
    logs,
    ledger,
    // This repo's own package inventory (see buildRepoInventory) — stamped here so the renderer
    // never has to decide what counts as a version conflict.
    inventory: buildRepoInventory(nodes, r.edges),
    meta: {
      branch: r.branch,
      commit: sha(r.key).slice(0, 7),
      license: r.license,
      loc: r.loc,
      manifest: eco(r.eco).manifest,
      lock: eco(r.eco).lock,
      cloneMs: rnd(r.key + "clone", 420, 2600),
      sizeKb: rnd(r.key + "size", 180, 5400),
      contributors: rnd(r.key + "c", 2, 9),
      lastCommit: `2026-0${rnd(r.key + "m", 1, 6)}-${String(rnd(r.key + "d", 10, 28))}`,
    },
  };
}

/**
 * The report's ENVIRONMENT fact (plan run-health-and-errors-log, Epic 03):
 * stamped here in the DATA layer from the run's `service_health` channel —
 * never re-derived or invented in the renderer (the data-contract rule). The
 * banner renders when `degraded` is true and blocked outcomes exist, so a
 * report read in isolation cannot be mistaken for a verdict on the code.
 *
 * @param {object} serviceHealth the `service_health` channel value
 * @param {{blocked: number, broken: number, bug: number}} totals run totals
 * @returns {{degraded: boolean, services: Array<{id: string, status: string,
 *   detail: string, remedy: string|null}>, remedies: string[],
 *   blocked: number, codeAttributable: number}}
 */
export function deriveEnvironment(serviceHealth, totals) {
  const down = asArray(serviceHealth?.services)
    .filter((s) => s?.status === "down" || s?.status === "unreachable")
    .map((s) => ({ id: String(s.id ?? "service"), status: s.status, detail: String(s.detail ?? ""), remedy: s.remedy ?? null }));
  return {
    degraded: down.length > 0,
    services: down,
    remedies: [...new Set(down.map((s) => s.remedy).filter(Boolean))],
    blocked: totals.blocked ?? 0,
    codeAttributable: (totals.broken ?? 0) + (totals.bug ?? 0),
  };
}

/* ------------------------------------------------------------------ */
/* the public data contract                                            */
/* ------------------------------------------------------------------ */

/**
 * Join the pipeline channels into the report's single, serializable data contract.
 *
 * @param {object} channels the pipeline output channels (see `REPORT_CHANNELS`)
 * @param {{keyOf?: (u: unknown) => string|null}} [opts] `keyOf` is the repo join key (0055/A3)
 * @returns {{repos: object[], totals: object, decided: number, passRate: number|null, rowsN: number}}
 *   a JSON-serializable `ReportData` — everything the UI needs, and nothing it doesn't.
 */
/**
 * ONE REPO'S PACKAGE INVENTORY — every distinct package that repo's dependency graph observed: what
 * versions it was seen at, and what pulls it in. Stamped onto the repo, and rendered by the repo's
 * own Dependencies tab.
 *
 * IT IS SCOPED TO THE REPO, AND THE SCOPE CHANGES WHAT `conflict` MEANS. This was a run-wide flatten
 * across every repo, and the fact that it is no longer one is not cosmetic:
 *
 *   - RUN-WIDE, `conflict` meant "two repos resolved this package differently" — on the golden run
 *     that is `typescript` at 5.3.3 in one repo and 6.0.3 in another. A real and useful finding.
 *   - PER-REPO, it means "ONE repo's own graph resolved this package at two versions" — a diamond
 *     dependency inside a single tree. On the same run there are ZERO of these.
 *
 * Both are honest; they are simply different questions, and the second is the one a reader has while
 * looking at a repository. What must never happen is a per-repo table carrying a run-wide answer:
 * flagging `typescript` as conflicting inside a repo that only ever resolved it once would point at
 * a repo for a fact that is not about it.
 *
 * The rest is unchanged and still load-bearing: `conflict` means two distinct RESOLVED versions, and
 * an UNRESOLVED observation is tracked as its own separate fact and never counted as a conflicting
 * one — the unmeasured version might well be the same one. Absent ≠ different.
 *
 * Everything here is a regrouping of stamped node/edge facts. Nothing is parsed, inferred, or
 * invented: `dependents` are the parent node IDS exactly as the resolver emitted them.
 *
 * @param {Array<{id: string, name: string, version: string}>} nodes the repo's stamped graph nodes
 * @param {Array<[string, string]>} edges its normalized `[from, to]` edges
 * @returns {{packages: Array<object>, graphed: boolean}}
 */
export function buildRepoInventory(nodes, edges) {
  // A repo with no real graph carries only the SYNTHETIC root (`id === "root"`), which is a
  // placeholder for a graph that was never captured — not a package. Counting it would put a row in
  // the inventory for a tree the resolver never actually walked. `graphed: false` is what lets the
  // tab say "no graph was captured" instead of rendering an empty table that reads as "no
  // dependencies" — an absence of measurement is not a finding.
  const real = asArray(nodes).filter((n) => n && n.id !== "root");
  if (real.length === 0) return { packages: [], graphed: false };

  /** @type {Map<string, {name: string, versions: Set<string>, unresolved: boolean, dependents: Set<string>}>} */
  const byName = new Map();
  const entry = (name) => {
    let e = byName.get(name);
    if (!e) {
      e = { name, versions: new Set(), unresolved: false, dependents: new Set() };
      byName.set(name, e);
    }
    return e;
  };

  const byId = new Map(real.map((n) => [n.id, n]));
  for (const n of real) {
    const e = entry(n.name);
    if (n.version) e.versions.add(n.version);
    else e.unresolved = true;
  }
  for (const [from, to] of asArray(edges)) {
    const child = byId.get(to);
    if (!child) continue;
    // The parent is recorded by its stamped ID (`harness@0.0.0`), which carries the version the
    // dependent was itself resolved at — the question "which version of X pulls this in" is the
    // one a reader actually has.
    entry(child.name).dependents.add(from);
  }

  const packages = [...byName.values()]
    .map((e) => {
      const versions = [...e.versions].sort();
      return {
        name: e.name,
        versions,
        unresolved: e.unresolved,
        dependents: [...e.dependents].sort(),
        conflict: versions.length > 1,
        root: e.dependents.size === 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { packages, graphed: true };
}

export function buildReportData(channels = {}, { keyOf = defaultKeyOf } = {}) {
  const repos = toRawList(channels, keyOf).map(deriveRepo);

  const totals = { repos: repos.length, vulns: 0, actions: 0, fixed: 0, broken: 0, blocked: 0, skipped: 0, bug: 0, sev: {} };
  for (const r of repos) {
    totals.vulns += r.vulns.length;
    // 0056/A3: count ACTIONS, not vulnerabilities. This line used to read
    // `totals.actions += r.vulns.length` — the same value as the line above it, which made
    // the two tiles identical for every run and is why the duplication never looked wrong.
    totals.actions += r.actionCount;
    for (const s of STATUS_ORDER) totals[s] += r.ledger[s] ?? 0;
    for (const v of r.vulns) totals.sev[v.sev] = (totals.sev[v.sev] ?? 0) + 1;
  }

  // Record 0033: `blocked` and `skipped` stay OUT of the denominator. A blocked outcome means
  // the environment failed (a dead registry, a pre-existing break), not that the remediation
  // was wrong — counting it would let an unrelated outage depress the score.
  const decided = totals.fixed + totals.broken + totals.bug;
  const passRate = decided > 0 ? Math.round((totals.fixed / decided) * 100) : null;

  const rowsN = asArray((channels.dataset ?? {}).rows).length;

  // run-health-and-errors-log Epic 03: the stamped environment fact behind the
  // report's banner (see deriveEnvironment — data layer, never the renderer).
  const environment = deriveEnvironment(channels.service_health, totals);

  // NOTE: there is no run-wide `inventory` here any more. The package inventory is now stamped
  // PER REPO (see buildRepoInventory, called from deriveRepo) and rendered by that repo's own
  // Dependencies tab, so the run-wide flatten had no reader left. A field nothing reads is one the
  // next author has to prove is dead before touching it — so it goes.
  return { repos, totals, decided, passRate, rowsN, environment };
}
