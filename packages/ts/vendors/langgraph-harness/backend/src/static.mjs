/**
 * static.mjs — dependency-free static hosting for the built frontend
 * (frontend/dist). Path-normalized (no `..` escapes), content-typed, with an
 * index.html fallback for SPA routes. Registered only when the dist exists.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

export async function registerStatic(app, distDir) {
  const root = resolve(distDir);
  const exists = await stat(join(root, "index.html")).then(
    (s) => s.isFile(),
    () => false,
  );
  if (!exists) return false;

  app.get("/*", async (request, reply) => {
    const urlPath = decodeURIComponent(new URL(request.url, "http://x").pathname);
    if (urlPath.startsWith("/api/")) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "unknown api route", details: {} } });

    let target = normalize(join(root, urlPath));
    if (!target.startsWith(root + sep) && target !== root) {
      return reply.code(403).send({ error: { code: "FORBIDDEN", message: "path escapes static root", details: {} } });
    }
    let fileStat = await stat(target).catch(() => null);
    if (!fileStat || fileStat.isDirectory()) {
      target = join(root, "index.html"); // SPA fallback
      fileStat = await stat(target);
    }
    reply.header("content-type", CONTENT_TYPES[extname(target)] ?? "application/octet-stream");
    reply.header("content-length", String(fileStat.size));
    return reply.send(createReadStream(target));
  });
  return true;
}
