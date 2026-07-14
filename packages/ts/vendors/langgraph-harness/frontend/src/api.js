/**
 * api.js — the backend client. Pure request builders + thin fetch wrappers
 * (the builders are unit-tested under node:test without a DOM).
 */

export function buildRunStreamUrl(base, flowName, { input, threadId, mock } = {}) {
  const params = new URLSearchParams();
  if (input && Object.keys(input).length > 0) params.set("input", JSON.stringify(input));
  if (threadId) params.set("thread_id", threadId);
  if (mock === false) params.set("mock", "false");
  const query = params.toString();
  return `${base}/api/flows/${encodeURIComponent(flowName)}/runs/stream${query ? `?${query}` : ""}`;
}

export function buildResumeUrl(base, flowName, threadId) {
  return `${base}/api/flows/${encodeURIComponent(flowName)}/threads/${encodeURIComponent(threadId)}/resume`;
}

async function json(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message ?? `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.envelope = body;
    throw err;
  }
  return body;
}

export function createApi(base = "") {
  return {
    base,
    health: () => json(`${base}/api/health`),
    meta: () => json(`${base}/api/meta`),
    flows: () => json(`${base}/api/flows`),
    flow: (name) => json(`${base}/api/flows/${encodeURIComponent(name)}`),
    graph: (name) => json(`${base}/api/flows/${encodeURIComponent(name)}/graph`),
    patterns: () => json(`${base}/api/patterns`),
    runs: () => json(`${base}/api/runs`),
    run: (id) => json(`${base}/api/runs/${encodeURIComponent(id)}`),
    startRun: (name, payload) =>
      json(`${base}/api/flows/${encodeURIComponent(name)}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      }),
    resume: (name, threadId, resume) =>
      json(buildResumeUrl(base, name, threadId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resume }),
      }),
    streamUrl: (name, opts) => buildRunStreamUrl(base, name, opts),
  };
}
