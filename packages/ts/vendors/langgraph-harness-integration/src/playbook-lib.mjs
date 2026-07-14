/**
 * src/playbook-lib.mjs — the shared step contract of the three playbook-driven
 * stages (`install-run`, `build-run`, `test-run`): the naming rule for a
 * RESCUE step's artifact.
 *
 * WHY THIS EXISTS (record 0066/D1). Every same-tool fallback rung in the
 * playbooks declares the SAME `artifact:` as the primary it rescues —
 * `python-build.log` on both rungs of `ecosystem-build/python/build.yaml`,
 * likewise `venv-create.log`, `pip-install.log`, `pytest.log`. When the primary
 * fails and the fallback succeeds, the rescue's stdout OVERWRITES the primary's
 * failure log: the evidence of what went wrong is destroyed at the moment it
 * became interesting, and any consumer that later quotes "the primary's log"
 * quotes a SUCCESS trace. That is how errors.logs came to cite `Successfully
 * built …whl` as proof of a build failure.
 *
 * THE RULE: a rescue whose artifact would collide with the primary's writes to
 * a `.fallback`-suffixed sibling instead. Both logs survive; the step records
 * keep pointing at their own artifact, so every consumer that reads
 * `step.artifact` (install-verify, errors-lib) stays correct by construction.
 * A fallback that already declares a DISTINCT artifact (npm-ci → npm-install,
 * gradlew-build → gradle-build) is left byte-unchanged — there was never a
 * collision to fix, and renaming its log would churn artifacts for no gain.
 */

/** `python-build.log` → `python-build.fallback.log` (extension-preserving; no extension → suffix appended). */
export function fallbackArtifactName(name) {
  if (typeof name !== "string" || name.length === 0) return name;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? `${name}.fallback` : `${name.slice(0, dot)}.fallback${name.slice(dot)}`;
}

/**
 * The spec to run for a rescue of `primary` — the fallback rung, with a
 * de-collided artifact when (and only when) it shares the primary's.
 * @param {{artifact?: string, fallback?: object}} primary the playbook step whose fallback is about to run
 * @returns {object|null} the rescue spec, or null when there is no fallback
 */
export function rescueSpecFor(primary) {
  const fallback = primary?.fallback;
  if (!fallback) return null;
  if (!fallback.artifact || fallback.artifact !== primary.artifact) return fallback;
  return { ...fallback, artifact: fallbackArtifactName(fallback.artifact) };
}
