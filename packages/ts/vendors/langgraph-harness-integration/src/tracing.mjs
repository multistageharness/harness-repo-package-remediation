/**
 * src/tracing.mjs — the TRACING SEAM (change record 0052/D1).
 *
 * WHY THIS EXISTS. `@langchain/core` installs a global callback manager that
 * exports a LangSmith trace for EVERY graph run whenever `LANGCHAIN_TRACING_V2`
 * (or the newer `LANGSMITH_TRACING`) is truthy in the environment. Nothing in this
 * toolkit asks for that — an inherited shell variable alone switches it on, and
 * the runs then fail with:
 *
 *   Failed to send multipart request. Received status [429]: Too Many Requests.
 *   {"error":"Too many requests: tenant exceeded usage limits: Monthly unique traces usage limit exceeded"}
 *
 * The LLM seam is NOT the source: `sdk/src/llm/provider.mjs` is a raw `fetch` and
 * never constructs a LangChain chat model. The traces come from the GRAPH RUNTIME
 * (`@langchain/langgraph`), so this must be neutralized around the graph run, not
 * around model calls.
 *
 * OFF BY DEFAULT, and not merely because of the quota error. Traces carry prompts,
 * repo names, manifest excerpts, and model replies — and this pipeline's entire
 * input domain is UNTRUSTED EXTERNAL CONTENT (crawled repos, dependency manifests,
 * PR/issue text). Shipping all of it to a third-party SaaS because a variable
 * happened to be exported is precisely the unconfirmed outward transmission the
 * project's security rules forbid (zero-trust external text; no unconfirmed
 * outward writes). Off is the correct posture independent of the 429.
 *
 * CREDENTIALS ARE NOT TOUCHED. `disableTracing` flips the SWITCHES and nothing
 * else — `LANGCHAIN_API_KEY` is left exactly as it was found. Disabling telemetry
 * is ours to do; mutating a user's credentials is not (security rule 5: creds are
 * env-only and unmanaged by the toolkit).
 *
 * Pure: mutates only the env object it is handed, returns what it changed.
 */

/** The switches that make @langchain/core export a trace. */
const TRACING_FLAGS = ["LANGCHAIN_TRACING_V2", "LANGSMITH_TRACING", "LANGCHAIN_TRACING"];

/** Explicit opt-in — the escape hatch for someone who genuinely wants traces. */
export const TRACING_OPT_IN = "HARNESS_TRACING";

const truthy = (v) => typeof v === "string" && ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());

/**
 * Neutralize LangChain/LangSmith tracing for this process unless explicitly
 * opted in via `$HARNESS_TRACING`.
 *
 * Must run BEFORE the graph is compiled/invoked. LangChain reads these variables
 * lazily per run (not once at import), so calling this at the top of the run seam
 * is sufficient — but a refactor that hoists graph construction earlier must hoist
 * this with it.
 *
 * @param {Record<string, string|undefined>} [env] defaults to `process.env`
 * @returns {{disabled: string[], optedIn: boolean}} the flags actually turned off
 */
export function disableTracing(env = process.env) {
  if (truthy(env[TRACING_OPT_IN])) return { disabled: [], optedIn: true };

  const disabled = [];
  for (const flag of TRACING_FLAGS) {
    // Only report what was actually ON — a flag that was already absent/false is
    // not a change, and callers use this list to decide whether to say anything.
    if (truthy(env[flag])) disabled.push(flag);
    env[flag] = "false";
  }
  return { disabled, optedIn: false };
}
