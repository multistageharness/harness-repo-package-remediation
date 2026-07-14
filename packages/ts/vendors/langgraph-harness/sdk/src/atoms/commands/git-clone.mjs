/**
 * commands.gitClone — clone a repository into a workspace dir via the argv
 * shell service. Idempotent (`on_exist: skip|fail`), mock returns a fixture
 * path with no network/git touched.
 */

import { access } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { runArgv } from "../../services/shell.mjs";

export const meta = {
  name: "commands.gitClone",
  category: "commands",
  summary: "git clone (argv-list, idempotent, mock-aware) → repo dir into a channel.",
  params: {
    type: "object",
    required: ["into"],
    properties: {
      url: { type: "string" },
      url_from: { type: "string" },
      workspace: { type: "string" },
      depth: { type: "integer", minimum: 1 },
      on_exist: { enum: ["skip", "fail"] },
      into: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

function slugFromUrl(url) {
  const tail = url.replace(/\/+$/, "").split("/").slice(-2).join("/");
  return tail.replace(/\.git$/, "").replaceAll("/", "__").replace(/[^A-Za-z0-9_.-]/g, "_");
}

export function gitClone(params, ctx) {
  return async (state) => {
    const url = params.url_from ? state[params.url_from] : params.url;
    if (typeof url !== "string" || url.length === 0) {
      throw new Error(`commands.gitClone: no url (url param or url_from channel '${params.url_from ?? ""}')`);
    }
    const workspaceRel = params.workspace ?? ".runs/workspace";
    const workspace = isAbsolute(workspaceRel) ? workspaceRel : resolve(ctx.options.baseDir, workspaceRel);
    const dir = join(workspace, slugFromUrl(url));

    if (ctx.options.mock) {
      return { [params.into]: { dir, url, cloned: false, mocked: true } };
    }

    const exists = await access(join(dir, ".git")).then(() => true, () => false);
    if (exists) {
      if ((params.on_exist ?? "skip") === "fail") throw new Error(`commands.gitClone: '${dir}' already exists`);
      return { [params.into]: { dir, url, cloned: false, existed: true } };
    }
    const argv = ["git", "clone", "--single-branch"];
    if (params.depth) argv.push("--depth", String(params.depth));
    argv.push(url, dir);
    await runArgv(argv, { timeoutMs: 300000 });
    return { [params.into]: { dir, url, cloned: true } };
  };
}
