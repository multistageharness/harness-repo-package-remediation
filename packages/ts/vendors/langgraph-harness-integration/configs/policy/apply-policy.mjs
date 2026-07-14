/**
 * configs/policy/apply-policy.mjs — the consuming half of the tri-state
 * matchers (Epic 04, story 04/01/02; record 0019/D3): Renovate's
 * `matchesRule` loop (null-skip, false-short-circuit), a first-match rule
 * applicator, and a strict loader for `remediation-policy.yaml`.
 *
 * Default-open by design: a candidate matching NO rule is allowed — the
 * shipped `remediation-policy.yaml` closes what must be closed (its deny
 * rule is first; first-match-wins makes ordering load-bearing).
 *
 * YAML note (verified, deviation recorded in the plan): the integration pack
 * resolves NO declared yaml package — the `yaml` module reachable from here
 * is a phantom transitive dependency, and the pack's flow wizard already
 * hand-rolls YAML emission for the same reason. The policy loader therefore
 * hand-rolls a STRICT SUBSET parser for exactly the policy grammar
 * (`policyRules:` + `- key: value` maps, inline `[a, b]` lists, quoted/bare
 * scalars, `#` comments) — zero new dependencies (platform rule 8), and
 * anything outside the subset is a loud error, never a guess.
 */

import { readFile } from "node:fs/promises";

const KNOWN_RULE_KEYS = ["matchEcosystem", "matchConfidenceAtLeast", "matchDepTypes", "matchRepoUrls", "skip"];

/** Renovate matchesRule semantics: null → no opinion, first false → deny. */
export function matchesPolicyRule(input, rule, matchers) {
  for (const matcher of matchers) {
    const result = matcher(input, rule);
    if (result === null || result === undefined) continue;
    if (!result) return false;
  }
  return true;
}

/**
 * First matching rule decides: a string `skip` field denies with that
 * reason; otherwise allows. No rule matching → allowed (default-open).
 */
export function applyPolicyRules(input, rules, matchers) {
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!matchesPolicyRule(input, rule, matchers)) continue;
    if (typeof rule.skip === "string" && rule.skip.length > 0) {
      return { allowed: false, skipReason: rule.skip, rule };
    }
    return { allowed: true, skipReason: null, rule };
  }
  return { allowed: true, skipReason: null, rule: null };
}

function parseScalar(token) {
  const t = token.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null" || t === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

function parseValue(raw, where) {
  const t = raw.trim();
  if (t.startsWith("[")) {
    if (!t.endsWith("]")) throw new Error(`policy parse error ${where}: unterminated inline list ${JSON.stringify(t)}`);
    const inner = t.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map(parseScalar);
  }
  if (t === "") throw new Error(`policy parse error ${where}: empty value (block values are outside the supported subset)`);
  return parseScalar(t);
}

/**
 * Strict subset parser for the policy document. Exported for tests.
 * Grammar: `policyRules:` at column 0, then `- key: value` items whose
 * continuation lines are indented `key: value` pairs; values are inline
 * lists or scalars; `#` comment lines and blank lines ignored.
 */
export function parsePolicyYaml(text) {
  const rules = [];
  let inRules = false;
  let current = null;
  const lines = String(text ?? "").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, "");
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const where = `at line ${i + 1}`;
    if (!inRules) {
      if (/^policyRules:\s*(\[\s*\])?\s*$/.test(line)) {
        inRules = true;
        continue;
      }
      throw new Error(`policy parse error ${where}: expected 'policyRules:' — got ${JSON.stringify(line.trim())}`);
    }
    const item = line.match(/^(\s*)-\s+(\S.*)$/);
    if (item) {
      current = {};
      rules.push(current);
      const kv = item[2].match(/^([A-Za-z][\w]*):\s*(.*)$/);
      if (!kv) throw new Error(`policy parse error ${where}: expected 'key: value' after '-'`);
      current[kv[1]] = parseValue(kv[2], where);
      continue;
    }
    const cont = line.match(/^\s+([A-Za-z][\w]*):\s*(.*)$/);
    if (cont && current) {
      current[cont[1]] = parseValue(cont[2], where);
      continue;
    }
    throw new Error(`policy parse error ${where}: outside the supported policy subset — ${JSON.stringify(line.trim())}`);
  }
  if (!inRules) throw new Error("policy parse error: document must declare 'policyRules:'");
  return { policyRules: rules };
}

/**
 * Load + validate the policy file: `{ policyRules: [...] }`, every rule's
 * keys ⊆ the known set — a violation names the rule index and offending key.
 */
export async function loadPolicy(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`policy: cannot read '${path}': ${err.message}`, { cause: err });
  }
  const doc = parsePolicyYaml(text);
  doc.policyRules.forEach((rule, index) => {
    for (const key of Object.keys(rule)) {
      if (!KNOWN_RULE_KEYS.includes(key)) {
        throw new Error(`policy: rule ${index} has unknown key '${key}' (known: ${KNOWN_RULE_KEYS.join(", ")}) in '${path}'`);
      }
    }
  });
  return doc.policyRules;
}
