/**
 * src/repo-url.mjs — the single source of truth for "what is a repo URL".
 *
 * Shared by the repo-column validation guard (Epic 02) and the dedup normalizer
 * (Epic 03) so the wizard preview and the `commands.collectRepos` atom recognize
 * and canonicalize URLs identically — no drift between what the user is shown and
 * what the flow actually dedups/clones. Pure and deterministic: no I/O, no seam,
 * no network. Regexes stay conservative (owner/repo = one non-slash segment each)
 * so a bare host or a non-repo path is rejected.
 */

// https://<host>/<owner>/<repo>(.git)?(/)?   — exactly two path segments
const HTTPS_RE = /^https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i;
// git@<host>:<owner>/<repo>(.git)?           — SCP-like SSH form
const SSH_RE = /^git@([^:\s]+):([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i;

/**
 * True when `s` looks like a clonable repo URL: an https URL with a
 * host + owner + repo path, or the `git@host:owner/repo.git` SSH form.
 * False for blanks, non-strings, bare hostnames, and non-repo paths.
 * @param {unknown} s
 * @returns {boolean}
 */
export function looksLikeRepoUrl(s) {
  if (typeof s !== "string") return false;
  const trimmed = s.trim();
  if (trimmed === "") return false;
  return HTTPS_RE.test(trimmed) || SSH_RE.test(trimmed);
}

/**
 * Canonicalize a repo URL so equivalent forms dedup to one entry:
 *   - trim; convert `git@host:o/r(.git)?` SSH → https;
 *   - lower-case the host; strip a trailing `/` and a trailing `.git`;
 *   - return `https://<host>/<owner>/<repo>` (owner/repo case preserved).
 * Returns `null` for anything that fails `looksLikeRepoUrl`, so the atom can
 * drop it. Idempotent: normalizeRepoUrl(normalizeRepoUrl(x)) === normalizeRepoUrl(x).
 * @param {unknown} input
 * @returns {string|null}
 */
export function normalizeRepoUrl(input) {
  if (!looksLikeRepoUrl(input)) return null;
  const s = input.trim();
  const parts = s.match(SSH_RE) ?? s.match(HTTPS_RE);
  if (!parts) return null;
  const [, host, owner, repo] = parts;
  return `https://${host.toLowerCase()}/${owner}/${repo}`;
}

/**
 * Guard a picked repo column: fail when no row carries the key, or when zero of
 * the first `sample` non-blank values pass `looksLikeRepoUrl`. Pure — the step
 * ingests a small sample and calls this before committing to the column.
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} column
 * @param {number} [sample=20] how many non-blank values to inspect
 * @returns {{ok: boolean, reason?: string}}
 */
export function validateRepoColumn(rows, column, sample = 20) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, reason: "no rows to sample" };
  }
  const present = rows.some((r) => r && Object.hasOwn(r, column));
  if (!present) {
    return { ok: false, reason: `column '${column}' is not present in the parsed rows` };
  }
  let seen = 0;
  let passed = 0;
  for (const row of rows) {
    const value = row?.[column];
    if (typeof value !== "string" || value.trim() === "") continue;
    seen += 1;
    if (looksLikeRepoUrl(value)) passed += 1;
    if (seen >= sample) break;
  }
  if (passed === 0) {
    return { ok: false, reason: `no repo-URL-looking values found in column '${column}'` };
  }
  return { ok: true };
}
