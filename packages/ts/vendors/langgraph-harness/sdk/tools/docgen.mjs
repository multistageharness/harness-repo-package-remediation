/**
 * tools/docgen.mjs — generate docs/patterns.md from the LIVE registry (the
 * project mapping incl. custom patterns), so the pattern reference cannot
 * drift from what a flow can actually `uses:`.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRegistry, writeFileAtomic } from "@internal/langgraph-langchain-harness-sdk";

const here = dirname(fileURLToPath(import.meta.url));
const langgraphLangchainHarnessRoot = resolve(here, "..", "..");
const mappingPath = join(langgraphLangchainHarnessRoot, "configs", "mapping.yaml");

const registry = await createRegistry(mappingPath);
const byCategory = await registry.describe();

const CATEGORY_ORDER = ["prompt", "template", "skills", "commands", "knowledge", "nodes", "edges", "condition", "checkpoints"];
const CATEGORY_BLURB = {
  prompt: "Prompt builders — every way a flow turns config + state into system/user messages.",
  template: "Deterministic renderers for reports and artifacts.",
  skills: "LLM reasoning atoms (the Agent half of Agent + Helpers).",
  commands: "Precision code I/O atoms (the Helpers half — argv shell, fs, http, git).",
  knowledge: "The offline deterministic RAG lane: load → chunk → embed → index → retrieve.",
  nodes: "Graph control shapes: routing, gating, HITL, fan-out markers, subgraphs, agents.",
  edges: "Topology wiring: how edge descriptors become LangGraph edges.",
  condition: "Safe predicates/routers compiled from the closed expression grammar.",
  checkpoints: "Thread persistence strategies (none / in-memory / durable file).",
};

let total = 0;
const lines = [
  "# langgraph-langchain-harness pattern reference (generated)",
  "",
  "> Generated from the live registry by `npm run docs` — cannot drift from",
  "> what a flow config can actually `uses:`. One atomic file per pattern.",
  "",
];

const sections = [];
for (const category of CATEGORY_ORDER) {
  const entries = byCategory[category] ?? [];
  total += entries.length;
  sections.push(`## \`${category}.*\` — ${entries.length} patterns`, "", CATEGORY_BLURB[category], "");
  sections.push("| pattern | module | summary |", "| --- | --- | --- |");
  for (const entry of entries) {
    sections.push(`| \`${entry.name}\` | \`${entry.module}\` | ${entry.summary} |`);
  }
  sections.push("");
}

lines.push(`**${total} patterns across ${CATEGORY_ORDER.length} categories.**`, "", ...sections);

const outPath = join(langgraphLangchainHarnessRoot, "docs", "patterns.md");
await writeFileAtomic(outPath, lines.join("\n"));
console.log(`wrote ${outPath} (${total} patterns)`);
