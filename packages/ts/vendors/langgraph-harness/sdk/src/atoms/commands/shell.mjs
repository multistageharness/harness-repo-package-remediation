/**
 * commands.shell — run an explicit argv-list subprocess ([bin, ...args],
 * never a shell string) and write {stdout, stderr, exit_code} into a channel.
 *
 * Under mock: no process is spawned; a deterministic fixture is returned —
 * the corpus contract that lets every example run offline.
 */

import { runArgv } from "../../services/shell.mjs";

export const meta = {
  name: "commands.shell",
  category: "commands",
  summary: "Run an argv-list subprocess (shell-injection impossible); result into a channel.",
  params: {
    type: "object",
    required: ["argv", "into"],
    properties: {
      argv: { type: "array", minItems: 1, items: { type: "string" } },
      argv_append_from: { type: "string" },
      cwd: { type: "string" },
      into: { type: "string", minLength: 1 },
      timeout_ms: { type: "integer", minimum: 1, maximum: 600000 },
      allow_nonzero: { type: "boolean" },
    },
  },
  returns: "node",
};

export function shell(params, ctx) {
  return async (state) => {
    const argv = [...params.argv];
    if (params.argv_append_from) {
      const extra = state[params.argv_append_from];
      if (Array.isArray(extra)) argv.push(...extra.map(String));
      else if (extra != null && extra !== "") argv.push(String(extra));
    }
    if (ctx.options.mock) {
      return {
        [params.into]: { stdout: `[mock shell] ${argv.join(" ")}`, stderr: "", exit_code: 0, mocked: true },
      };
    }
    const result = await runArgv(argv, {
      cwd: params.cwd ?? ctx.options.baseDir,
      timeoutMs: params.timeout_ms,
      allowNonZero: params.allow_nonzero ?? false,
    });
    return { [params.into]: { stdout: result.stdout, stderr: result.stderr, exit_code: result.exitCode } };
  };
}
