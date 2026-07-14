/**
 * skills.detectSetup — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): LLM-scan each
 * fingerprinted repo to auto-detect how to setup / install / run / test it
 * (`langgraph-flow.md` step 8). Reads the `fingerprints` channel emitted by
 * `commands.repoFingerprint` (each `{ url, dir, fingerprint }`) and produces a
 * flat `integrated` array — one structured command-array manifest per repo —
 * that the integrate report node writes to `.harness/integrated.json`.
 *
 * OWNERSHIP: the manifest CONTRACT and every deterministic rule that shapes it
 * — the structured-output schema, per-ecosystem command defaults, ecosystem
 * sniff, mock/stub builder, zero-trust excerpt sanitizer + bounded gatherer,
 * the model prompt, and the confidence-reason cap — live in the vendored
 * repository-fingerprint report library (`@repo-fingerprint/report`, bridged
 * through `../../src/fingerprint-lib.mjs`). This atom keeps ONLY the host
 * orchestration the library can't own: iterating the state channel, the mock
 * decision, the single `ctx.llm.invoke` seam call, validating the model reply,
 * the `llm.call`/`llm.result` events, and assembling the final entry from the
 * imported builders.
 *
 * Seam rule: the model is reached ONLY via `ctx.llm.invoke({system, user,
 * schema})` — the single provider seam — never a provider SDK import; the
 * `llm.call`/`llm.result` events mirror the SDK's skill atoms. Credentials
 * stay env-only at that seam.
 *
 * Mock seam (offline acceptance contract): under `ctx.options.mock` — or for
 * any entry whose `dir` is absent on disk (mock/failed clones) — the atom
 * returns a deterministic STUB manifest with NO filesystem read and NO llm
 * call, mirroring `repo-fingerprint.mjs`. A mock-provider reply (the silent
 * no-credentials fallback, `result.mode === "mock"`) is likewise turned into a
 * populated stub rather than passed through as `source:"llm"`. Only the degrade
 * path (real model, unusable reply) keeps empty arrays — a genuine "real scan,
 * no usable answer".
 */

import { access } from "node:fs/promises";

import { callLlm, validateSchema } from "../../src/sdk.mjs";
import { installLocations } from "../../src/repo-modules.mjs";
import {
  MANIFEST_SCHEMA,
  SYSTEM_PROMPT,
  capReason,
  resolveEcosystem,
  readManifest,
  stubManifest,
  gatherExcerpts,
  buildUserPrompt,
  // re-exported below so this atom's public surface (and its unit test) is unchanged.
  sanitizeExcerpt,
  defaultCommands,
} from "../../src/fingerprint-lib.mjs";

export { sanitizeExcerpt, resolveEcosystem, defaultCommands };

export const meta = {
  name: "skills.detectSetup",
  category: "skills",
  summary: "LLM-scan each fingerprinted repo (bounded manifest excerpts, zero-trust, mock-aware) → integrated setup/install/run/test manifests.",
  params: {
    type: "object",
    required: ["fingerprints_from", "into"],
    properties: {
      fingerprints_from: { type: "string", minLength: 1 },
      into: { type: "string", minLength: 1 },
      model: { type: "string" },
    },
  },
  returns: "node",
};

export function detectSetup(params, ctx) {
  return async (state) => {
    const entries = Array.isArray(state[params.fingerprints_from]) ? state[params.fingerprints_from] : [];
    const integrated = [];
    const total = entries.length;
    let index = 0;
    for (const entry of entries) {
      // Per-item progress tick (change record 0012/A1) — see repo-fingerprint.mjs
      // for the full rationale. `integrate` is a SINGLE node looping over N repos,
      // and its per-repo `llm.call`/`llm.result` events fire only on the real-scan
      // path (mock/stub entries skip them), so they can't drive a bar for every
      // repo. We emit one bounded, idempotent `loop.guard` (kind: "stage") per
      // entry, BEFORE the mock/stub branch, so the animated bar advances once per
      // repo on every path. REUSES a known SDK event type (unknown types throw in
      // the vendored hub) — no pristine-SDK edit, inside the pack trust boundary.
      index += 1;
      ctx.emit?.("loop.guard", { node: ctx.node?.id, count: index, max: total, kind: "stage" });
      const url = entry?.url ?? null;
      const dir = entry?.dir ?? null;
      const fingerprint = entry?.fingerprint ?? null;

      // Failed clone (0019/A1): the fingerprint stage marks entries whose clone
      // failed with `cloneError` — surface the class in the stub's reason and
      // propagate it as a sibling field so `.harness/integrated.json` stays
      // legible ("403" vs "bad URL" vs "we chose not to clone"). Checked FIRST
      // so the class survives every path, including mock.
      if (typeof entry?.cloneError === "string" && entry.cloneError.length > 0) {
        const resolved = await resolveEcosystem(fingerprint, dir, { mock: true });
        integrated.push({ ...stubManifest(url, dir, resolved, `clone failed: ${entry.cloneError}`), cloneError: entry.cloneError });
        continue;
      }

      // Stub under mock or when there is no real repo dir on disk.
      if (ctx.options.mock || typeof dir !== "string" || dir.length === 0) {
        const resolved = await resolveEcosystem(fingerprint, dir, { mock: true });
        integrated.push(stubManifest(url, dir, resolved, "mock run"));
        continue;
      }
      const exists = await access(dir).then(() => true, () => false);
      if (!exists) {
        const resolved = await resolveEcosystem(fingerprint, dir, { mock: true });
        integrated.push(stubManifest(url, dir, resolved, "repo dir missing"));
        continue;
      }

      const { excerpts, findings } = await gatherExcerpts(dir);
      const system = SYSTEM_PROMPT;
      const user = buildUserPrompt(url, fingerprint, excerpts);

      // 0062/A4 — the seam is reached through the SDK's OWN `callLlm` helper (which
      // wraps ctx.llm.invoke with the llm.call/llm.result pair), not a hand-rolled
      // copy of it. Anything the seam grows — token usage, retries, redaction — now
      // reaches this atom, which is one of the two that actually run in this pipeline.
      const result = await callLlm(ctx, {
        nodeId: ctx.node?.id,
        system,
        user,
        schema: MANIFEST_SCHEMA,
        model: params.model,
      });

      // A mock-provider reply (the silent no-credentials fallback) is not an
      // LLM detection: never pass its schema skeleton through as source:"llm" /
      // confidence:"high" / "mock-…-ecosystem". Emit the deterministic populated
      // stub instead, keeping any excerpt findings.
      //
      // 0042/A1+A2: a real clone `dir` is on disk here (we passed the `exists`
      // check above), so ground the stub in the repo's OWN manifest — read its
      // declared scripts + lockfile offline (D1, no LLM) so a fabricated command
      // is pruned (`npm start` for a repo with no `start` script) and confidence
      // rises off the floor when the manifest evidence is real and deterministic.
      // 0051/A1: attach `modules` here too. The install/build/test stages select
      // their playbook per MODULE (`integrated[].modules`), so a stub without one
      // starves them: they skip `no-playbook` and write no logs at all. Locations
      // are derived from the FINGERPRINT — deterministic, no model, no fs — so the
      // stub can carry them at full fidelity even though its commands are defaults.
      if (result.mode === "mock") {
        const resolved = await resolveEcosystem(fingerprint, dir, { mock: false });
        const manifestInfo = await readManifest(dir, resolved.ecosystem);
        const stub = stubManifest(url, dir, resolved, "provider mode: mock", manifestInfo);
        integrated.push({ ...stub, modules: installLocations(fingerprint), findings: [...findings, ...stub.findings] });
        continue;
      }

      const manifest = result.structured;
      if (manifest === undefined || validateSchema(manifest, MANIFEST_SCHEMA).length > 0) {
        // Degrade, never guess: a real model's unusable reply yields an EMPTY
        // low-confidence manifest and a note — a genuine "real scan, no usable
        // answer" stays distinguishable from mock defaults.
        // 0051/A2: "degrade, never guess" governs the COMMANDS, not the LOCATIONS.
        // The model declined to answer, so the command arrays stay empty — but the
        // modules are fingerprint-derived and remain knowable regardless of what it
        // said. Omitting them here would silently skip install/build/test (same
        // starvation as A1, reached by a different route).
        integrated.push({
          url: url ?? null,
          dir: dir ?? null,
          ecosystem: fingerprint?.dominantEcosystem ?? null,
          setup: [],
          install: [],
          run: [],
          test: [],
          modules: installLocations(fingerprint),
          confidence: "low",
          confidenceReason: `low — model reply unusable (${result.parse_error ?? "schema mismatch"}) — no evidence-based confidence`,
          source: "llm",
          findings: [
            ...findings,
            { severity: "minor", file: null, note: `model reply unusable (${result.parse_error ?? "schema mismatch"}) — empty manifest` },
          ],
        });
        continue;
      }

      // 0025/D4 as amended by 0026/A2: attach the repo's INSTALL LOCATIONS
      // AFTER schema validation and compute them DETERMINISTICALLY from the
      // fingerprint — never from the model. Entries are `{dir, manifest,
      // ecosystem}` (ecosystem-tagged so a consumer can select a playbook
      // without re-sniffing basenames) and span EVERY ecosystem the
      // fingerprint records plus `subRepos[]` — not the dominant lane group
      // alone, which dropped a python-dominant repo's nested node service and
      // read the shadow-scanned sub-repos with nothing. MANIFEST_SCHEMA lives
      // in the pristine mirror, so attaching post-validation needs no schema
      // edit (platform rule 6).
      const modules = installLocations(fingerprint);
      const manifestModules = modules.filter((m) => typeof m.manifest === "string");
      const setupFindings = [...findings];
      // Degrade, never guess (the same discipline as the unusable-reply path
      // above): an empty `install` over a repo with real project manifests is
      // REPORTED, not repaired by synthesizing commands the model declined to
      // emit. Rule-3 modules (no manifest at all) have nothing to report.
      if (manifest.install.length === 0 && manifestModules.length > 0) {
        setupFindings.push({
          severity: "minor",
          file: null,
          note: `install is empty while the fingerprint records ${manifestModules.length} project manifest(s) (${manifestModules.map((m) => m.manifest).join(", ")})`,
        });
      }

      integrated.push({
        url,
        dir,
        ecosystem: manifest.ecosystem ?? fingerprint?.dominantEcosystem ?? null,
        setup: manifest.setup,
        install: manifest.install,
        run: manifest.run,
        test: manifest.test,
        modules,
        confidence: manifest.confidence,
        confidenceReason: capReason(manifest.confidenceReason) || `${manifest.confidence} — model returned no rationale`,
        source: "llm",
        findings: setupFindings,
      });
    }
    return { [params.into]: integrated };
  };
}
