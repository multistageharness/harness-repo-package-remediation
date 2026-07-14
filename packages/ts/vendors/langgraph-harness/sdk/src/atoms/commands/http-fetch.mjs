/**
 * commands.httpFetch — HTTP GET a url (literal or from a channel) and write
 * {status, body} into a channel. Mock returns a deterministic offline fixture.
 */

export const meta = {
  name: "commands.httpFetch",
  category: "commands",
  summary: "HTTP GET → {status, body} into a channel (deterministic fixture under mock).",
  params: {
    type: "object",
    required: ["into"],
    properties: {
      url: { type: "string" },
      url_from: { type: "string" },
      into: { type: "string", minLength: 1 },
      timeout_ms: { type: "integer", minimum: 1, maximum: 120000 },
      max_bytes: { type: "integer", minimum: 1 },
    },
  },
  returns: "node",
};

export function httpFetch(params, ctx) {
  return async (state) => {
    const url = params.url_from ? state[params.url_from] : params.url;
    if (typeof url !== "string" || url.length === 0) {
      throw new Error(`commands.httpFetch: no url (url param or url_from channel '${params.url_from ?? ""}')`);
    }
    if (ctx.options.mock) {
      return { [params.into]: { status: 200, body: `[mock http] GET ${url}`, mocked: true } };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeout_ms ?? 30000);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
      let body = await res.text();
      const cap = params.max_bytes ?? 2 * 1024 * 1024;
      if (body.length > cap) body = body.slice(0, cap);
      return { [params.into]: { status: res.status, body } };
    } finally {
      clearTimeout(timer);
    }
  };
}
