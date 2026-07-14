/**
 * src/snapshot-lib.mjs — the single site that reaches into the vendored
 * repo filesystem-snapshot library (`@repo-snapshots/tool`).
 *
 * The snapshot-shaping logic is OWNED by the tools-repo-filesystem-snapshots
 * tool (harness-repo-package-remediation/vendors/tools-repo-filesystem-snapshots/packages/mjs/) — a
 * dependency-free, no-build ESM module. It is imported by RELATIVE path into
 * that pristine mirror, NOT as a declared dependency, mirroring how
 * src/fingerprint-lib.mjs bridges the repository-fingerprint report library and
 * src/sdk.mjs bridges the vendored @internal/langgraph-langchain-harness-sdk. The `configs/patterns/snapshot.mjs`
 * atom imports these builders from HERE (staying inside the pack's trust
 * boundary) and supplies the host concerns the library deliberately does not
 * own: the caller-stamped timestamp, atomic file writes, state channels, and the
 * mock seam.
 */
export {
  // walk a clone and shape the .snapshot.json contract (spawns the argv git call)
  buildSnapshot,
  // deterministic offline stub (mock seam — no git, no fs, no network)
  stubSnapshot,
} from "../../tools-repo-filesystem-snapshots/packages/mjs/index.mjs";
