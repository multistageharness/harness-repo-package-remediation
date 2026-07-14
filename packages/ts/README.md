# Harness

> **Dependency policy: exact pins only** — no `^`, `~`, or range constraints on any dependency,
> anywhere. Contributors and CI must resolve to a deterministic tree.

## Overview

Harness is a Node ESM monorepo that ingests Excel (`.xlsx`) and CSV files through a layered
`Core → SDK → CLI` design:

- **`@harness/core`** — the ingestion engine: contracts, CSV/XLSX readers, format detection,
  row normalization, diagnostics, and the `ingest()` pipeline.
- **`@harness/sdk`** — a thin, ergonomic programmatic facade over core (`ingest()`, options,
  result surface, async-iterator streaming).
- **`@harness/cli`** — the `harness ingest <file>` command, wired end-to-end through the SDK.

This is the **scaffolding** milestone: a walking skeleton that reads a trivial CSV/XLSX fixture
end-to-end and emits normalized JSON. Deep parsing/validation/transform features come later.

## Layout

```
packages/
  core/    @harness/core — ingestion engine
  sdk/     @harness/sdk  — programmatic facade
  cli/     @harness/cli  — harness ingest CLI
fixtures/  shared sample.csv / sample.xlsx used by every layer's tests
scripts/   verify.mjs — offline test/verify orchestrator
```

## Requirements

- Node **≥ 20** (see `.nvmrc`).
- npm workspaces (npm 10+).

## Dev loop

```sh
make install   # npm install
make test      # per-workspace tests
make verify    # lint + full offline test gate
```

Tests are **mock-first**: `node:test` only, no network, no real API keys, no git required.

## Regenerating fixtures

`fixtures/sample.xlsx` is generated from `fixtures/make-xlsx.mjs`:

```sh
node fixtures/make-xlsx.mjs
```
