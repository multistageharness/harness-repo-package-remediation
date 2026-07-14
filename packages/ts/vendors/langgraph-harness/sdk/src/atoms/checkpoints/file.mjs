/**
 * checkpoints.file — durable JSON-file checkpointer.
 *
 * Extends MemorySaver (so all tuple/list/pending-writes semantics are the
 * battle-tested upstream ones) and adds persistence: every mutation flushes
 * the serialized store to disk atomically; a new process (or a new saver
 * instance) pointed at the same file resumes threads across restarts. The
 * serde payloads are treated as opaque bytes (base64 in the JSON snapshot),
 * so this survives upstream serializer changes.
 *
 * This is the enterprise upgrade the corpus lacked — every HITL project
 * there loses threads on process exit.
 */

import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { MemorySaver } from "@langchain/langgraph";

import { writeFileAtomic } from "../../services/atomic-fs.mjs";

export const meta = {
  name: "checkpoints.file",
  category: "checkpoints",
  summary: "Durable JSON-file checkpointer — threads survive process restarts.",
  params: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1 },
    },
  },
  returns: "checkpointer",
};

const toB64 = (bytes) => ({ __b64: Buffer.from(bytes).toString("base64") });
const isB64 = (v) => v != null && typeof v === "object" && typeof v.__b64 === "string";
const fromB64 = (v) => new Uint8Array(Buffer.from(v.__b64, "base64"));

export class FileSaver extends MemorySaver {
  constructor(path) {
    super();
    this.path = path;
    this._flushChain = Promise.resolve();
    this._load();
  }

  _load() {
    let text;
    try {
      text = readFileSync(this.path, "utf8");
    } catch {
      return; // no snapshot yet — start empty
    }
    try {
      const doc = JSON.parse(text);
      for (const [tid, namespaces] of Object.entries(doc.storage ?? {})) {
        this.storage[tid] = Object.create(null);
        for (const [ns, checkpoints] of Object.entries(namespaces)) {
          this.storage[tid][ns] = Object.create(null);
          for (const [cid, [cp, md, parent]] of Object.entries(checkpoints)) {
            this.storage[tid][ns][cid] = [fromB64(cp), fromB64(md), parent ?? undefined];
          }
        }
      }
      for (const [outerKey, inner] of Object.entries(doc.writes ?? {})) {
        this.writes[outerKey] = Object.create(null);
        for (const [innerKey, [taskId, channel, value]] of Object.entries(inner)) {
          this.writes[outerKey][innerKey] = [taskId, channel, isB64(value) ? fromB64(value) : value];
        }
      }
    } catch (err) {
      throw new Error(`checkpoints.file: snapshot '${this.path}' is corrupt: ${err.message}`);
    }
  }

  _snapshot() {
    const storage = {};
    for (const [tid, namespaces] of Object.entries(this.storage)) {
      storage[tid] = {};
      for (const [ns, checkpoints] of Object.entries(namespaces)) {
        storage[tid][ns] = {};
        for (const [cid, [cp, md, parent]] of Object.entries(checkpoints)) {
          storage[tid][ns][cid] = [toB64(cp), toB64(md), parent ?? null];
        }
      }
    }
    const writes = {};
    for (const [outerKey, inner] of Object.entries(this.writes)) {
      writes[outerKey] = {};
      for (const [innerKey, [taskId, channel, value]] of Object.entries(inner)) {
        writes[outerKey][innerKey] = [taskId, channel, ArrayBuffer.isView(value) ? toB64(value) : value];
      }
    }
    return JSON.stringify({ version: 100, storage, writes });
  }

  _flush() {
    // serialize flushes so concurrent puts never interleave partial snapshots
    const next = this._flushChain.then(() => writeFileAtomic(this.path, this._snapshot()));
    this._flushChain = next.catch(() => {});
    return next;
  }

  async put(config, checkpoint, metadata, newVersions) {
    const result = await super.put(config, checkpoint, metadata, newVersions);
    await this._flush();
    return result;
  }

  async putWrites(config, writes, taskId) {
    await super.putWrites(config, writes, taskId);
    await this._flush();
  }

  async deleteThread(threadId) {
    await super.deleteThread(threadId);
    await this._flush();
  }
}

/** @returns {FileSaver} */
export function file(params = {}, ctx = { options: {} }) {
  const relPath = params.path ?? ".runs/checkpoints.json";
  const abs = isAbsolute(relPath) ? relPath : resolve(ctx.options?.baseDir ?? ".", relPath);
  return new FileSaver(abs);
}
