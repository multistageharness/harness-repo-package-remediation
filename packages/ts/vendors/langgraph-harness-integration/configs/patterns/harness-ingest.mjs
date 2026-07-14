/**
 * commands.harnessIngest — CUSTOM pattern (project-local, mapped via
 * langgraph-harness-integration/configs/mapping.yaml): ingest a CSV/XLSX file into
 * normalized rows via `@harness/sdk`'s `ingest()` and write them to the
 * `out` channel. This is the reference bridge from the `@harness/` ingestion
 * monorepo into langgraph-harness's flow engine — harness contributes precision I/O,
 * langgraph-harness contributes reasoning + topology.
 *
 * Contract (verified by the registry, matching sdk/src/atoms/commands/fs-read.mjs):
 *   - exports `meta` (name === mapping key, category === "commands") + one factory.
 *   - factory is fn(params, ctx) → async (state) => delta; writes ONLY `out`
 *     (plus optional `diagnostics_into`), so the wrapNode write filter passes.
 *   - reaches NO provider SDK and NO model seam — it is pure, deterministic
 *     library I/O over a local file, so (like commands.fsRead) it runs for
 *     real even under mock. No network, no key, no shell, no `../` escape.
 *
 * `@harness/sdk` resolves as a bare specifier from this file's location (the
 * pack is an npm workspace of the harness root — see ../../README.md). The
 * mapping entry stays `./patterns/harness-ingest.mjs`, so langgraph-harness's trust
 * boundary (relative modules must live under the mapping dir) is satisfied.
 *
 * IN-MEMORY SOURCE (change record 0021/D2). Beyond `path` / `path_from`, the atom
 * accepts `content_from` (a channel holding a string or `Uint8Array`) plus an
 * optional `filename` for format detection. This is what lets the `remote_csv`
 * ingest lane parse a FETCHED, SANITIZED body without writing a temp file (and
 * without its cleanup/TOCTOU surface). Nothing new is required downstream:
 * `@harness/sdk`'s `ingest()` already takes "a file path or a source object"
 * (packages/sdk/src/ingest.mjs), `IngestSource` already declares
 * `{ path?, buffer?, stream?, filename? }`, and `pipeline.mjs` derives its label
 * from `source.filename || source.path`. Purely additive: no existing caller
 * passes `content_from`, so every current path keeps its behavior exactly.
 *
 * MOCK FIXTURE SHORT-CIRCUIT (0021/D5.6). `commands.httpFetch`'s mock body is the
 * literal string `[mock http] GET <url>` — not parseable CSV. Under `--mock` a
 * `content_from` lane would therefore ingest zero rows and drive an empty-but-
 * green pipeline, breaking the acceptance contract's "end-to-end under --mock"
 * in substance if not in exit code. So a `content_from` node may declare
 * `mock_path`: under mock the atom ingests that committed CSV fixture instead of
 * the channel content. The lane short-circuits; the built-in fetch atom stays
 * pristine (no `mock_body_from` param bolted onto the vendored SDK).
 * `mock_path` is inert on real runs and ignored when `content_from` is unset.
 */

import { isAbsolute, resolve } from "node:path";

export const meta = {
  name: "commands.harnessIngest",
  category: "commands",
  summary: "Ingest a CSV/XLSX file — or in-memory content — into normalized rows via @harness/sdk.",
  params: {
    type: "object",
    required: ["out"],
    properties: {
      path: { type: "string", minLength: 1 },
      path_from: { type: "string", minLength: 1 },
      // 0021/D2 — in-memory source: a channel holding a string / Uint8Array body
      content_from: { type: "string", minLength: 1 },
      // filename used for format detection when ingesting `content_from`
      filename: { type: "string", minLength: 1 },
      // 0021/D5.6 — under --mock, ingest this committed fixture instead of the
      // (non-CSV) mock fetch body. Only consulted alongside `content_from`.
      mock_path: { type: "string", minLength: 1 },
      out: { type: "string", minLength: 1 },
      format: { enum: ["auto", "csv", "xlsx"] },
      limit: { type: "integer", minimum: 1 },
      headers: { type: "boolean" },
      diagnostics_into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

/** Resolve a relative path against the flow dir, matching commands.fsRead. */
const rooted = (rel, ctx) => (isAbsolute(rel) ? rel : resolve(ctx.options.baseDir, rel));

/**
 * Pick the `ingest()` source: an in-memory `{ buffer, filename }` when
 * `content_from` is set (with the `mock_path` fixture standing in under mock),
 * else the absolute path from `path` / `path_from`.
 */
function resolveSource(params, ctx, state) {
  if (params.content_from) {
    if (ctx.options.mock && params.mock_path) return rooted(params.mock_path, ctx);
    const content = state[params.content_from];
    if (typeof content !== "string" && !(content instanceof Uint8Array)) {
      throw new Error(
        `commands.harnessIngest: channel '${params.content_from}' holds no string/Uint8Array content (got ${typeof content})`,
      );
    }
    return { buffer: Buffer.from(content), filename: params.filename ?? "remote.csv" };
  }

  const rel = params.path_from ? state[params.path_from] : params.path;
  if (typeof rel !== "string" || rel.length === 0) {
    throw new Error(
      `commands.harnessIngest: no source (set 'path', 'path_from' → a channel, or 'content_from' → a channel; path_from='${params.path_from ?? ""}')`,
    );
  }
  return rooted(rel, ctx);
}

export function harnessIngest(params, ctx) {
  return async (state) => {
    const source = resolveSource(params, ctx, state);

    const { ingest } = await import("@harness/sdk");
    const options = {};
    if (params.format) options.format = params.format;
    if (params.limit != null) options.limit = params.limit;
    if (params.headers != null) options.headers = params.headers;

    const result = await ingest(source, options);
    // The SDK never throws on a failed read — it reports an error-severity
    // diagnostic (e.g. READ_FAILED, UNKNOWN_FORMAT) and returns zero rows. Left
    // unchecked, a bad path would end the run green with an empty dataset — the
    // exact state the ingest flow's fail_unknown lane exists to prevent. Partial
    // data (rows alongside error diagnostics) still flows through, observable
    // via diagnostics_into; only the nothing-was-read state is refused.
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    if (result.rows.length === 0 && errors.length > 0) {
      throw new Error(
        `commands.harnessIngest: ingest yielded zero rows with ${errors.length} error diagnostic(s) — ` +
          `first: ${errors[0].code}: ${errors[0].message}. Refusing an empty-but-green run.`,
      );
    }
    // No custom event emit: the wrapNode boundary already emits node.start /
    // node.end (with the written channels), and the event hub only accepts the
    // enumerated EVENT_TYPES — matching built-in commands.* atoms like fsRead.
    const delta = { [params.out]: result.rows };
    if (params.diagnostics_into) delta[params.diagnostics_into] = result.diagnostics;
    return delta;
  };
}
