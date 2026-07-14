# `RemediationReport`

The repo-remediation report organism: aggregate stats, an outcome filter, per-repo cards,
and a drill-down with advisories, a dependency graph, and stage logs.

## Props

| Prop | Type | Notes |
|------|------|-------|
| `repos` | `Repo[]` | **Required.** The run's repositories. The source JSX hardcoded these; the consumer owns them now. |
| `title` | `string` | Report heading. Defaults to `Repository remediation report`. |
| `subtitle` | `ReactNode` | Provenance line under the title (session id, timestamp). |
| `onOpenRepo` | `(name: string) => void` | Fired when a repo is opened. Selection is tracked internally regardless. |
| `featureFlag` | `string` | When resolved OFF, the organism renders `featureFlagFallback`. |
| `featureFlagFallback` | `ReactNode` | Defaults to `null`. |

## Usage

```tsx
import { RemediationReport } from '@harness/langgraph-repo-remediation-html-report-reactjs';

<RemediationReport repos={repos} subtitle="session 95703650" />;
```

## Variants

- **Default** — a mixed run (fixed / broken / blocked / skipped).
- **AllFixed** — uniformly green. The one shape in which the known renderer defects cannot manifest.
- **WithBroken** — a failing repo; the outcome chip must be red.
- **AllBlocked** — nothing decided, so the pass rate is an em-dash, not `0%`.
- **Empty** — no repositories ingested.
- **Hidden** — the feature flag is off; renders nothing.

## Invariant

**Pass rate = fixed / (fixed + broken + bug).** Blocked and skipped are EXCLUDED — a repo
blocked by a dead registry is not a remediation failure, and counting it as one makes the
number lie (record 0033).
