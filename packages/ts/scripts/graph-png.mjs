#!/usr/bin/env node
// Render a compiled langgraph flow to a PNG (default: harness.png).
//
// The reference of truth is the COMPILED graph, not the yaml text: this script
// shells out to the vendored `langgraph-langchain-harness graph <flow> --format json` command — the same
// interface the generate-langgraph-flow skill derives langgraph-flow.md from — so a
// node or edge that exists in the picture is one the compiler actually wired. That
// keeps this a derived artifact and leaves `src/sdk.mjs` the pack's single import
// seam into the vendored SDK.
//
// Topology JSON → Mermaid flowchart → PNG via mermaid-cli (`mmdc`). Zero runtime
// deps of our own; subprocesses take argv arrays, never interpolated command
// strings (v100 security rule 4).
//
//   node scripts/graph-png.mjs                       # repo-remediation → harness.png
//   node scripts/graph-png.mjs ingest --out ingest.png
//   node scripts/graph-png.mjs --format svg --direction LR --keep-mmd
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const LANGGRAPH_LANGCHAIN_HARNESS = join(root, 'vendors', 'langgraph-harness', 'cli', 'src', 'main.mjs');
const PACK = join(root, 'vendors', 'langgraph-harness-integration');

// ── argv parsing (house style: hand-rolled, no deps) ─────────────────────────

function parseArgs(argv) {
  const flags = { format: 'png', direction: 'TD', scale: '3', background: 'white', keepMmd: false, group: 'layer' };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out' || arg === '-o') flags.out = argv[++i];
    else if (arg === '--format') flags.format = argv[++i];
    else if (arg === '--direction') flags.direction = argv[++i];
    else if (arg === '--group') flags.group = argv[++i];
    else if (arg === '--scale') flags.scale = argv[++i];
    else if (arg === '--background') flags.background = argv[++i];
    else if (arg === '--keep-mmd') flags.keepMmd = true;
    else if (arg === '--mmd-only') flags.mmdOnly = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg.startsWith('-')) fail(`unknown flag '${arg}'\n\n${USAGE}`);
    else positional.push(arg);
  }
  if (flags.group !== 'layer' && flags.group !== 'none') {
    fail(`unknown --group mode '${flags.group}' (expected 'layer' or 'none')\n\n${USAGE}`);
  }
  return { flow: positional[0] ?? 'repo-remediation', flags };
}

const USAGE = `usage: node scripts/graph-png.mjs [flow] [options]

  flow            a flow name in ${'vendors/langgraph-harness-integration/configs/flows'} (default: repo-remediation)

options:
  -o, --out <path>      output file (default: <flow>.png, or harness.png for repo-remediation)
      --format <fmt>    png | svg | pdf                      (default: png)
      --direction <d>   mermaid rank direction: TD | LR | BT (default: TD)
      --group <mode>    cluster nodes by orchestration layer: layer | none (default: layer)
                        layer = LangGraph orchestration vs LangChain execution
      --scale <n>       raster scale factor                  (default: 3)
      --background <c>  background colour, or 'transparent'  (default: white)
      --keep-mmd        also write the intermediate .mmd beside the output
      --mmd-only        write the .mmd and skip PNG rendering (no mmdc needed)

rendering requires mermaid-cli on PATH (\`mmdc\`), a local node_modules/.bin/mmdc,
or an explicit path in $MMDC.`;

function fail(message) {
  process.stderr.write(`graph-png: ${message}\n`);
  process.exit(1);
}

// ── 1. authoritative topology, straight from the compiler ────────────────────

/** Run `langgraph-langchain-harness graph <flow> --format json` and parse its topology. */
function loadTopology(flow) {
  const res = spawnSync(
    process.execPath,
    [
      LANGGRAPH_LANGCHAIN_HARNESS,
      'graph',
      flow,
      '--mapping',
      join(PACK, 'configs', 'mapping.yaml'),
      '--flows-dir',
      join(PACK, 'configs', 'flows'),
      '--format',
      'json',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (res.status !== 0) fail(`langgraph-langchain-harness graph failed (exit ${res.status ?? 'signal'}):\n${res.stderr ?? ''}`);
  try {
    return JSON.parse(res.stdout);
  } catch (err) {
    fail(`langgraph-langchain-harness graph did not emit valid JSON: ${err.message}`);
  }
}

// ── 2. topology → mermaid ────────────────────────────────────────────────────

// START/END are compiler-injected sentinels with no node record. `end` is a
// mermaid keyword, so both get prefixed ids and an explicit display label.
const START = '__start';
const END = '__end';

/** Mermaid chokes on a bare `"` inside a quoted label; nothing else needs escaping. */
function label(text) {
  return `"${String(text).replace(/"/g, '&quot;')}"`;
}

/** Node shape by atom category — a fan-out reads differently from a plain command. */
function shape(id, text, uses) {
  const l = label(text);
  if (uses === 'nodes.fanout') return `${id}{{${l}}}`; // hexagon — dispatches N branches
  if (uses === 'nodes.subgraph') return `${id}[[${l}]]`; // subroutine — a nested flow
  if (uses?.startsWith('skills.')) return `${id}(${l})`; // rounded — LLM-backed
  return `${id}[${l}]`; // rectangle — deterministic command
}

/** Edge arrow + optional label, keyed on the kind the edge atom reported. */
function arrow(edge) {
  const l = edge.label ? `|${label(edge.label)}|` : '';
  switch (edge.kind) {
    case 'fanout':
      return `==>${l}`; // thick — the Send-API parallel region
    case 'switch':
    case 'conditional':
    case 'loop':
      return `-.->${l}`; // dashed — a runtime-evaluated branch
    default:
      return `-->${l}`;
  }
}

/** Which class each node carries, so classDef styling stays declarative. */
function styleClass(node) {
  if (node.category === 'synthetic') return 'synthetic';
  if (node.uses === 'nodes.fanout' || node.uses === 'nodes.subgraph') return 'structural';
  if (node.uses?.startsWith('skills.')) return 'llm';
  return 'command';
}

// Subgraph clusters keyed on the orchestration layer. The grouping key is the
// existing `styleClass` verdict — `llm` (skills.* → ctx.llm) is the LangChain
// execution seam; every other class is a deterministic LangGraph stage — so the
// picture stays a derived view of the compiled topology, not a second source of
// truth. Order controls emission order of the clusters themselves.
const LAYER_CLUSTERS = [
  { id: 'cluster_langgraph', title: 'LangGraph orchestration', isMember: (cls) => cls !== 'llm' },
  { id: 'cluster_langchain', title: 'LangChain execution', isMember: (cls) => cls === 'llm' },
];

function toMermaid(topo, { direction, group }) {
  const lines = [`flowchart ${direction}`];
  const byClass = new Map();

  // One declaration per node; keep topo order and remember each node's class so
  // the layer clustering below reuses the same styleClass verdict as classDef.
  const decls = new Map();
  const classOf = new Map();
  for (const node of topo.nodes) {
    decls.set(node.id, shape(node.id, `${node.id}<br/>${node.uses}`, node.uses));
    const cls = styleClass(node);
    classOf.set(node.id, cls);
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(node.id);
  }

  lines.push(`  ${START}([${label('START')}])`);
  if (group === 'layer') {
    // Wrap the stage nodes in two subgraphs; sentinels and cross-cluster edges
    // stay outside so the compiler-reported topology is drawn unchanged.
    for (const cluster of LAYER_CLUSTERS) {
      const ids = topo.nodes.map((n) => n.id).filter((id) => cluster.isMember(classOf.get(id)));
      if (ids.length === 0) continue; // e.g. a flow with no skills.* nodes
      lines.push(`  subgraph ${cluster.id}[${label(cluster.title)}]`);
      // A subgraph `direction` accepts TB/BT/LR/RL only — not the TD alias the
      // flowchart header takes — so normalize the shared --direction here.
      lines.push(`    direction ${direction === 'TD' ? 'TB' : direction}`);
      for (const id of ids) lines.push(`    ${decls.get(id)}`);
      lines.push('  end');
    }
  } else {
    for (const node of topo.nodes) lines.push(`  ${decls.get(node.id)}`);
  }
  lines.push(`  ${END}([${label('END')}])`);
  lines.push('');

  const rename = (ref) => (ref === 'START' ? START : ref === 'END' ? END : ref);
  for (const edge of topo.edges) {
    lines.push(`  ${rename(edge.from)} ${arrow(edge)} ${rename(edge.to)}`);
  }
  lines.push('');

  // Modern Minimalist: charcoal text on white, light-gray borders, slate accents.
  lines.push('  classDef command fill:#ffffff,stroke:#d3d3d3,stroke-width:1px,color:#36454f');
  lines.push('  classDef structural fill:#f7f8f9,stroke:#708090,stroke-width:1.5px,color:#36454f');
  lines.push('  classDef llm fill:#ffffff,stroke:#708090,stroke-width:1.5px,color:#36454f');
  lines.push('  classDef synthetic fill:#ffffff,stroke:#d3d3d3,stroke-width:1px,color:#708090');
  lines.push('  classDef sentinel fill:#36454f,stroke:#36454f,color:#ffffff');
  for (const [cls, ids] of byClass) {
    if (ids.length > 0) lines.push(`  class ${ids.join(',')} ${cls}`);
  }
  lines.push(`  class ${START},${END} sentinel`);

  return `${lines.join('\n')}\n`;
}

// ── 3. mermaid → png ─────────────────────────────────────────────────────────

/** Prefer an explicit $MMDC, then a local install, then PATH. */
function resolveMmdc() {
  if (process.env.MMDC) return process.env.MMDC;
  const local = join(root, 'node_modules', '.bin', 'mmdc');
  if (existsSync(local)) return local;
  const which = spawnSync('command', ['-v', 'mmdc'], { shell: '/bin/sh', encoding: 'utf8' });
  const found = which.stdout?.trim();
  return found || null;
}

function render(mmdPath, outPath, flags) {
  const mmdc = resolveMmdc();
  if (!mmdc) {
    fail(
      `mermaid-cli not found. Install it (\`npm i -g @mermaid-js/mermaid-cli\`), set $MMDC,\n` +
        `or re-run with --mmd-only to emit just the diagram source.`,
    );
  }
  const res = spawnSync(
    mmdc,
    ['--input', mmdPath, '--output', outPath, '--backgroundColor', flags.background, '--scale', flags.scale],
    { cwd: root, stdio: 'inherit' },
  );
  if (res.error) fail(`could not run mmdc (${mmdc}): ${res.error.message}`);
  if (res.status !== 0) fail(`mmdc exited ${res.status}`);
}

// ── main ─────────────────────────────────────────────────────────────────────

const { flow, flags } = parseArgs(process.argv.slice(2));
if (flags.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const defaultName = flow === 'repo-remediation' ? 'harness' : flow;
const outArg = flags.out ?? `${defaultName}.${flags.format}`;
const outPath = isAbsolute(outArg) ? outArg : resolve(root, outArg);

const topo = loadTopology(flow);
const mermaid = toMermaid(topo, flags);

const scratch = mkdtempSync(join(tmpdir(), 'graph-png-'));
const mmdPath = join(scratch, `${defaultName}.mmd`);
writeFileSync(mmdPath, mermaid, 'utf8');

try {
  if (flags.mmdOnly) {
    const dest = outPath.replace(/\.(png|svg|pdf)$/, '.mmd');
    copyFileSync(mmdPath, dest);
    console.log(`graph-png: wrote ${dest} (${topo.nodes.length} nodes, ${topo.edges.length} edges)`);
  } else {
    render(mmdPath, outPath, flags);
    if (flags.keepMmd) copyFileSync(mmdPath, outPath.replace(/\.(png|svg|pdf)$/, '.mmd'));
    console.log(`graph-png: wrote ${outPath} (${topo.nodes.length} nodes, ${topo.edges.length} edges)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
