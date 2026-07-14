# `@harness/langgraph-repo-remediation-html-report-reactjs`

**The UI of the repo-remediation report.** `src/report/` is not a preview of the report or a twin of
it — it *is* the report. Vite compiles this tree, with React compiled in, into three self-contained
artifacts that are committed into `../langgraph-repo-remediation-html-report-generator/vendor/`, and
that package embeds them in one offline HTML page. The generator is purely the data layer
(`buildReportData(channels) → ReportData`); it authors no markup, CSS, or script (record 0057).

React's dependencies are needed at **build** time, never at **runtime** — which is how the generator
keeps its zero-dependency, offline, no-external-asset invariants while there is only one UI.

## Quick start

```bash
make up     # install + start vite (background)
make logs   # tail the dev log
make down   # stop
```

Dev URL: <http://localhost:5247>

## The dev server renders the real report

`http://localhost:5247` renders the shipped tree over the data of a report the flow actually emitted
— it reads the JSON island back out of `.harness/<session-id>/repo-remediation.html`, which is the
same `ReportData` that page carries. Open the page and the dev server side by side and they agree,
because they are the same components over the same data with the same stylesheet.

That is a fix, not a given. Record 0057 unified the shipped renderer on React but left the dev
harness mounting the old design mock (`organisms/RemediationReport`) over invented fixtures, so
`localhost:5247` and `repo-remediation.html` showed visibly different reports — the drift 0057 was
filed to end, surviving in the one place nobody was comparing.

- Renders the newest session by default; the bottom-right picker crosses **sessions × variants**.
- **`/mock/` is the design mock** — `organisms/RemediationReport`, with the four example routes
  (default / empty / all-blocked / flag-off). It is a **separate page**, not a route: the mock is
  styled with Tailwind, whose preflight is a global reset, and a separate document is the only thing
  that keeps that stylesheet out of the report's cascade. Do not merge the two.

### Every example has its own URL

| URL | Example |
| --- | --- |
| <http://localhost:5247/as-run> | the session exactly as the flow emitted it (`/` lands here) |
| <http://localhost:5247/blocked> | the same repos, every outcome blocked — pass rate is an em-dash, not `0%` |
| <http://localhost:5247/empty> | the same dataset, zero repositories ingested |
| <http://localhost:5247/mock/> | the design mock — plus `/mock/empty`, `/mock/blocked`, `/mock/hidden` |

Link one, bookmark one, paste one into a review. Add `?session=<id>` to choose **which** emitted run
supplies the data — the example is the path (a fact about the report), the session stays a query (a
fact about this machine's disk, and not an address anyone else can open).

[`dev/routes.ts`](./dev/routes.ts) is the only place that parses these URLs, and the report's paths
are derived from `VARIANTS` — add a variant and its URL comes with it.

### One dataset, several variants

Every example on both pages is a **variant of the same real emitted session** — never a hand-written
fixture. `dev/variants.ts` holds pure `ReportData → ReportData` transforms:

| variant | what it shows |
|---|---|
| `as-run` | the session exactly as the flow emitted it |
| `blocked` | the same repos, every outcome blocked — pass rate is an **em-dash, not `0%`** (a wholly blocked run scoring 0% is the false verdict record 0033 fixed) |
| `empty` | the same dataset, zero repos ingested |

Totals are recomputed from the repos, never hand-written, so a derived run is as internally
consistent as a captured one. A fixture is a *different thing* from a small real run — it has its own
field names, its own vocabularies, and its own idea of what a repo looks like, and each of those
divergences is a bug the dev harness then cannot show you. The mock consumes the same data through
`dev/mock/adapt.ts`, whose lossy mappings are worth reading: they are an inventory of what the older
contract cannot express.

When no report is on disk, both pages say what to run — neither falls back to a fixture, because that
fallback is precisely how this harness drifted from the shipped page before.
- `HARNESS_REPORT_HTML=<file>` renders one specific report; `HARNESS_SESSIONS_DIR=<dir>` points at a
  different directory of sessions.
- No report on disk? The page tells you what to run. It does **not** fall back to fixtures — a
  fixture that looks like a report is exactly how this drifted before.

```bash
npm run check:report          # every emitted report on disk came from THIS tree — byte-for-byte
npm run build:bundle -- --check   # the committed bundle is fresh from src/report/
```

Together those two close the chain end to end: `src/report/` → committed bundle → emitted page.
`check:report` re-renders a page's own data through the committed bundle and requires the result to
match that page's prerendered `#root` exactly, so "this package renders that HTML" is a checkable
fact rather than a claim in a README.

## Layout

- `src/report/` — **the report.** `Report.tsx` (composition root), `Overview`, `RepoDetail`, `Rail`,
  `Graph`, `Logs`, the `types.ts` data contract, and `report.css` — the only stylesheet that ships.
- `src/report/entry-server.tsx` / `entry-client.tsx` — the prerender and hydration halves of the
  committed bundle.
- `dev/` — the report's dev harness (`/`): `main.tsx` mounts the report, `sessions.mjs` finds and
  reads real data. No stylesheet.
- `dev/mock/` — the design mock's dev harness (`/mock/`): its own page, its own router, the four
  `example-*.tsx` reference integrations, and the package's only Tailwind stylesheet.
- `scripts/` — `build-bundle.mjs` (build + publish the bundle), `check-report.mjs` (the parity gate).
- `src/atoms/`, `src/molecules/`, `src/organisms/RemediationReport/`, `src/featureFlags/` — the
  **original design mock** the report was derived from. Still tested, still exported, still
  previewable at `/mock/` — but it does not ship and it is not the report.

## Invariants

- `/` renders the shipped tree over shipped data. Never repoint it at the mock or at fixtures.
- Tailwind lives on `/mock/`'s page and nowhere else — the emitted page carries `report.css` alone,
  and Tailwind's preflight alone would restyle it. The two pages stay two documents.
- Any change under `src/report/` requires `npm run build:bundle`.
- `src/report/` uses plain global class names (never CSS Modules): the generator's tests and the
  pack's matrix tests assert on literal markup, and CSS Modules hash their class names.
- Navigation stays in CSS `:checked` radios, never React state — the report must be complete and
  navigable with the script blocked.
- This package is never a `harness` workspace member; its dependencies must not reach the
  dependency-free generator.
