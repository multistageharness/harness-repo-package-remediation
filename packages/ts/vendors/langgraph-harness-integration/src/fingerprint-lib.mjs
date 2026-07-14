/**
 * src/fingerprint-lib.mjs — the single site that reaches into the vendored
 * repository-fingerprint report library (`@repo-fingerprint/report`).
 *
 * The report-generation logic is OWNED by the fingerprint tool
 * (harness-repo-package-remediation/vendors/repository-fingerprint/packages/mjs/) — a dependency-free,
 * no-build ESM module. It is imported by RELATIVE path into that pristine
 * mirror, NOT as a declared dependency, mirroring how src/sdk.mjs bridges the
 * vendored @internal/langgraph-langchain-harness-sdk. The `configs/patterns/*.mjs` atoms import these builders
 * from HERE (staying inside the pack's trust boundary) and supply the host
 * concerns the library deliberately does not own: the LLM seam, subprocess
 * execution, model-reply validation, state channels, and events.
 */
export {
  // integrated.json (setup/install/run/test manifest) shaping
  MANIFEST_SCHEMA,
  SYSTEM_PROMPT,
  capReason,
  resolveEcosystem,
  readManifest,
  stubManifest,
  sanitizeExcerpt,
  gatherExcerpts,
  buildUserPrompt,
  // fingerprints.json entry shaping
  parseReport,
  stubFingerprint,
} from "../../repository-fingerprint/packages/mjs/index.mjs";

// Per-ecosystem command defaults now come from the consolidated ecosystem
// registry (0019/A4) — same data, same shape, one source; the export surface
// of this bridge is unchanged so every consumer (and test) is untouched.
// (The vendored library keeps its internal table for stubManifest — the
// registry's data is byte-equal to it by construction.)
export { defaultCommands } from "./ecosystem-registry.mjs";
