/**
 * chips.tsx — the report's chip primitives.
 *
 * Deliberately NOT the `atoms/Chip` design-mock component. That one is a CSS Module, and a CSS
 * Module hashes its class names — but `class="chip chip-out"` and `data-out="broken"` are asserted
 * literally by `behavior.test.mjs` and by the pack's matrix tests. The markup vocabulary is a
 * contract (record 0057/A6), so these emit plain global classes against `report.css`.
 */
import { eco, overallChipOf, sev } from './tokens';
import type { Outcome, Verdict } from './types';

export const Chip = ({ cls, text }: { cls: string; text: string }) => (
  <span className={`chip ${cls}`}>{text}</span>
);

export const SevChip = ({ s }: { s: string }) => (
  <span className="chip chip-sev" data-sev={s}>
    {s}
  </span>
);

export const EcoChip = ({ e }: { e: string }) => (
  <span className="chip chip-eco" data-eco={e}>
    {eco(e).label}
  </span>
);

/** The chip whose COLOR is driven by `data-out` — the CSS colors off that attribute, not the text. */
export const OutChip = ({ k, text }: { k: Outcome; text?: string }) => (
  <span className="chip chip-out" data-out={k}>
    {text ?? k}
  </span>
);

/**
 * A repo's overall-verdict chip.
 *
 * Record 0056/A2: the defect this replaces hardcoded the chip KEY to `"fixed"` while taking the
 * TEXT from the verdict — so a failed repo rendered the word "failed" inside a GREEN chip. Color is
 * the fastest-read signal on the page and that inverted it for exactly the runs that matter: a
 * reviewer skimming a red run saw a wall of green. Both call sites (the overview table and the
 * detail header) go through here so they cannot drift apart again — the original defect was
 * precisely two copies of one expression.
 */
export const OverallChip = ({ overall }: { overall: Verdict | string }) => {
  const { key, text } = overallChipOf(overall);
  return <OutChip k={key} text={text} />;
};

/** A severity dot. `sev()` falls back to `unknown` rather than indexing the table blind (0057/F4). */
export const SevDot = ({ s, sm = false }: { s: string; sm?: boolean }) => (
  <span className={sm ? 'sev-dot sm' : 'sev-dot'} style={{ background: sev(s).hex }} />
);
