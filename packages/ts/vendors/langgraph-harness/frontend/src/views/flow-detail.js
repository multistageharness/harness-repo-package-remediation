/**
 * views/flow-detail.js — the heart of the console: topology SVG, validation,
 * yaml source, and the live run panel (SSE event stream, interrupt→resume).
 */

import { el, svgEl, fmtJson, clear } from "../ui.js";
import { layoutTopology } from "../graph-layout.js";

const CATEGORY_VAR = {
  skills: "var(--cat-skills)",
  commands: "var(--cat-commands)",
  knowledge: "var(--cat-knowledge)",
  nodes: "var(--cat-nodes)",
  synthetic: "var(--cat-synthetic)",
  terminal: "var(--cat-terminal)",
};

function renderGraph(topology) {
  const layout = layoutTopology(topology);
  const svg = svgEl("svg", { class: "graph", width: layout.width, height: layout.height, viewBox: `0 0 ${layout.width} ${layout.height}` });
  svg.append(
    svgEl(
      "defs",
      {},
      svgEl(
        "marker",
        { id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
        svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "var(--muted)" }),
      ),
    ),
  );

  for (const edge of layout.edges) {
    const midX = (edge.x1 + edge.x2) / 2;
    const path = edge.backward
      ? `M ${edge.x1} ${edge.y1} C ${edge.x1 + 40} ${edge.y1 - 46}, ${edge.x2 - 40} ${edge.y2 - 46}, ${edge.x2} ${edge.y2}`
      : `M ${edge.x1} ${edge.y1} C ${midX} ${edge.y1}, ${midX} ${edge.y2}, ${edge.x2} ${edge.y2}`;
    svg.append(svgEl("path", { class: `edge${edge.backward ? " backward" : ""}`, d: path }));
    if (edge.label) {
      svg.append(svgEl("text", { class: "edge-label", x: midX, y: (edge.y1 + edge.y2) / 2 - 6, "text-anchor": "middle", text: edge.label }));
    }
  }

  for (const node of layout.nodes) {
    const group = svgEl("g", { class: "node", transform: `translate(${node.x}, ${node.y})` });
    const stroke = CATEGORY_VAR[node.category] ?? "var(--line)";
    group.append(
      svgEl("rect", {
        width: node.w,
        height: node.h,
        rx: 7,
        stroke,
        "stroke-dasharray": node.kind === "synthetic" ? "4 3" : "none",
        fill: "var(--panel)",
      }),
      svgEl("text", { x: 10, y: 18, text: node.id, "font-weight": node.kind === "terminal" ? "700" : "500" }),
      svgEl("text", { class: "uses", x: 10, y: 33, text: node.uses }),
    );
    svg.append(group);
  }
  return el("div", { class: "graph-wrap" }, svg);
}

function eventRow(event) {
  const detail = Object.entries(event)
    .filter(([key]) => !["seq", "ts", "type"].includes(key))
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
  return el(
    "div",
    { class: `ev${event.type.includes("error") ? " err" : ""}` },
    el("span", { class: "t", text: event.type }),
    el("span", { class: "d", text: detail }),
  );
}

function runPanel(api, flowName) {
  const inputBox = el("textarea", { rows: 3, text: "{}" });
  const mockToggle = el("input", { type: "checkbox", checked: "checked" });
  const runBtn = el("button", { text: "Run (stream)" });
  const log = el("div", { class: "event-log" });
  const outcome = el("div", { class: "stack" });
  const resumeArea = el("div", { class: "stack" });

  let source = null;

  function setBusy(busy) {
    runBtn.disabled = busy;
    runBtn.textContent = busy ? "Running…" : "Run (stream)";
  }

  function showResult(result) {
    clear(outcome);
    if (result.status === "interrupted") {
      outcome.append(el("div", { class: "banner warn", text: `Interrupted — thread ${result.thread_id}` }));
      outcome.append(el("pre", { class: "code", text: fmtJson(result.interrupt) }));
      const resumeBox = el("textarea", { rows: 2, text: '{"approve": true}' });
      const resumeBtn = el("button", {
        text: "Resume thread",
        onclick: async () => {
          resumeBtn.disabled = true;
          try {
            const resumed = await api.resume(flowName, result.thread_id, JSON.parse(resumeBox.value));
            showResult({ ...resumed, thread_id: resumed.thread_id });
          } catch (err) {
            outcome.append(el("div", { class: "banner err", text: `resume failed: ${err.message}` }));
          } finally {
            resumeBtn.disabled = false;
          }
        },
      });
      clear(resumeArea).append(el("label", { class: "field", text: "Resume value (JSON)" }), resumeBox, resumeBtn);
    } else {
      clear(resumeArea);
      outcome.append(
        el("div", {
          class: `banner ${result.status === "completed" ? "ok" : "err"}`,
          text: result.status === "completed" ? `Completed — last_step: ${result.state?.last_step}` : `Failed — ${result.message ?? ""}`,
        }),
      );
      if (result.state) outcome.append(el("pre", { class: "code", text: fmtJson(result.state) }));
    }
  }

  runBtn.addEventListener("click", () => {
    let input;
    try {
      input = JSON.parse(inputBox.value || "{}");
    } catch (err) {
      clear(outcome).append(el("div", { class: "banner err", text: `input is not valid JSON: ${err.message}` }));
      return;
    }
    clear(log);
    clear(outcome);
    clear(resumeArea);
    setBusy(true);
    source?.close();
    source = new EventSource(api.streamUrl(flowName, { input, mock: mockToggle.checked }));
    source.addEventListener("run.event", (msg) => {
      log.append(eventRow(JSON.parse(msg.data)));
      log.scrollTop = log.scrollHeight;
    });
    source.addEventListener("run.result", (msg) => {
      showResult(JSON.parse(msg.data));
      setBusy(false);
      source.close();
    });
    source.addEventListener("run.error", (msg) => {
      const error = JSON.parse(msg.data);
      clear(outcome).append(el("div", { class: "banner err", text: `${error.code}: ${error.message}` }));
      setBusy(false);
      source.close();
    });
    source.onerror = () => {
      setBusy(false);
      source.close();
    };
  });

  return el(
    "div",
    { class: "card" },
    el("h2", { text: "Run" }),
    el("label", { class: "field", text: "Input channels (JSON)" }),
    inputBox,
    el("div", { class: "row", style: "margin: 10px 0" }, el("label", { class: "inline" }, mockToggle, "mock mode"), runBtn),
    el("h2", { text: "Live events" }),
    log,
    outcome,
    resumeArea,
  );
}

export async function flowDetailView(api, name) {
  const [detail, topology] = await Promise.all([api.flow(name), api.graph(name)]);
  const validation = detail.validation;

  return el(
    "section",
    {},
    el("h1", { text: detail.name }),
    el("p", { text: detail.description, style: "color: var(--muted); margin-top: -8px" }),
    el(
      "div",
      { class: "row", style: "margin-bottom: 12px" },
      el("span", { class: `pill ${validation.ok ? "ok" : "err"}`, text: validation.ok ? "valid" : `invalid (${validation.issues.length})` }),
      el("span", { class: "pill", text: `checkpointer: ${detail.config.runtime.checkpointer.replace("checkpoints.", "")}` }),
      el("span", { class: "pill", text: `entry: ${detail.config.entry}` }),
      el("span", { class: "pill", text: `recursion: ${detail.config.runtime.recursion_limit}` }),
    ),
    validation.ok
      ? null
      : el(
          "pre",
          { class: "code", text: validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n") },
        ),
    el("h2", { text: "Topology" }),
    renderGraph(topology),
    el(
      "div",
      { class: "layout-2col", style: "margin-top: 14px" },
      el("div", { class: "card" }, el("h2", { text: "flow yaml" }), el("pre", { class: "code", text: detail.yaml })),
      runPanel(api, name),
    ),
  );
}
