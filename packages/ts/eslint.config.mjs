import js from '@eslint/js';

// Node globals used across the workspace. Declared explicitly to avoid pulling in
// the `globals` package as an extra (non-pinned) dependency.
const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  queueMicrotask: 'readonly',
  structuredClone: 'readonly',
  globalThis: 'readonly',
};

export default [
  {
    // vendors/langgraph-harness and vendors/repository-fingerprint are pristine git-subtree
    // mirrors, each with its OWN lint/verify gate — never lint them from the consumer (they
    // pass upstream, not harness's ruleset). vendors/tools-cli-progress-bar is a pristine
    // tarball-digest-pinned mirror (verbatim upstream @thinkeloquent/cli-progressor, see its
    // VENDOR.md) and is excluded for the same reason. The harness-owned integration pack
    // (vendors/langgraph-harness-integration) and the harness-owned
    // vendors/tools-repo-filesystem-snapshots ARE linted.
    // `.harness/` is the gitignored runtime working directory: it holds the real repos the
    // interactive CLI clones (`make start` runs for real) and rendered report artifacts —
    // foreign sources, never harness-owned code, so it is out of scope for the lint gate.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.harness/**',
      'vendors/langgraph-harness/**',
      'vendors/repository-fingerprint/**',
      // The committed React bundle (record 0057/D1) is generated output — Vite's work, with React
      // compiled in. Linting it means linting React. Its freshness is gated by `build:bundle --check`.
      'vendors/langgraph-repo-remediation-html-report-generator/vendor/**',
      // The React report package is TS/TSX; this config carries no TypeScript parser, so ESLint
      // cannot read it. It is NOT ungated (record 0057/A7): Biome lints it (see biome.json — its
      // TS/TSX passes the recommended preset clean), and `scripts/verify.mjs` delegates to the
      // package's own `typecheck` + `vitest` scripts. It stays out of the npm workspace on purpose
      // — its build-time React toolchain must never become resolvable from the dependency-free
      // generator. (The prior comment here claimed "it lints itself"; nothing did.)
      'vendors/langgraph-repo-remediation-html-report-reactjs/**',
      'vendors/tools-cli-progress-bar/**',
      // vendors/claude-sdk and vendors/github-sdk are SYMLINKS to a sibling checkout of the two
      // LLM harness SDKs (record 0062/D1) — foreign code with its own gate (each ships its own
      // offline `node --test` suite), reached only by guarded dynamic import. Linting through the
      // symlink would drag another repo's source into this repo's gate; the adapter that CONSUMES
      // them (vendors/langgraph-harness-integration/src/llm/) is harness-owned and IS linted.
      'vendors/claude-sdk/**',
      'vendors/github-sdk/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: nodeGlobals,
    },
  },
];
