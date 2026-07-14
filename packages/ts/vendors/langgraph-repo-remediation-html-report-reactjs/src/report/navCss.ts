/**
 * navCss.ts — the per-run navigation stylesheet (ported from the generator's `style.mjs › dynamicNav`).
 *
 * THIS IS WHAT MAKES THE REPORT WORK WITHOUT JAVASCRIPT, and it is the reason record 0057/D3 exists.
 *
 * View switching, repo selection, and the inner tabs are driven by hidden `<input type="radio">`
 * elements and CSS `:checked ~` sibling selectors — not by React state. A React tree that held the
 * open repo in `useState` would render exactly ONE repo's detail into the prerendered markup and
 * mount the others only on click. That breaks two things at once:
 *
 *   1. The no-JS invariant the generator's README commits to — a reader with JS disabled would see
 *      one view with no way to reach any other.
 *   2. `behavior.test.mjs`, which slices FIVE different repo cards out of the emitted HTML by index
 *      and asserts on each. It is the gate that proves record 0056's three defect fixes still hold.
 *      One-view-at-a-time makes four of those five cards simply not exist.
 *
 * So every repo detail and both views are rendered up front and CSS decides what is visible.
 * Hydration then layers the enhancements (search, filters, toggles) on top; it never owns navigation.
 *
 * It is GENERATED rather than static because it enumerates each repo index and each inner tab.
 */

/**
 * MUST stay in lockstep with `RepoDetail.tsx`'s own `TABS`. A tab listed there and missing here is
 * rendered into the DOM with no selector that can ever display it — nothing throws, no test fails,
 * and the panel is simply invisible forever. (`graph` was once removed from both when the per-repo
 * SVG gave way to a run-wide Dependencies view; `deps` was added to both when the inventory came
 * back into the repo card as a table. `reportSurface.test.ts` now pins the two lists together.)
 */
const TABS = ['plan', 'deps', 'logs', 'meta'] as const;

/** Build the CSS that wires each hidden radio to the panels it reveals. */
export function navCss(repoCount: number): string {
  const rules: string[] = [];

  // top-level view switch + active seg label. There are TWO views: the run overview and the
  // repositories. Dependencies is no longer among them — the package inventory is a tab INSIDE each
  // repo's card now, driven by the per-repo tab radios below.
  rules.push('.view{display:none}');
  rules.push('#rr-view-overview:checked ~ .view-overview{display:block}');
  rules.push('#rr-view-repositories:checked ~ .view-repositories{display:block}');
  rules.push(
    '#rr-view-overview:checked ~ .topbar .seg-overview,#rr-view-repositories:checked ~ .topbar .seg-repositories{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(15,23,42,.08)}',
  );

  // repo selection: which detail / rail / sidebar entry is active
  rules.push('.repo-detail{display:none}');
  rules.push('.rail-group{display:none}');

  for (let i = 0; i < repoCount; i++) {
    rules.push(`#rr-repo-${i}:checked ~ .view-repositories .repo-detail[data-idx="${i}"]{display:block}`);
    rules.push(
      `#rr-repo-${i}:checked ~ .view-repositories .rail-group[data-idx="${i}"]{display:flex;flex-direction:column;gap:1rem}`,
    );
    rules.push(
      `#rr-repo-${i}:checked ~ .view-repositories .repo-btn[data-idx="${i}"]{background:var(--indigo-bg);box-shadow:inset 0 0 0 1px #c7d2fe}`,
    );
    rules.push(`#rr-repo-${i}:checked ~ .view-repositories .repo-btn[data-idx="${i}"] .repo-btn-key{color:#3730a3}`);

    // inner tabs, scoped to this repo-detail
    for (const t of TABS) {
      rules.push(`#rr-tab-${i}-${t}:checked ~ .tab-panel[data-tab="${t}"]{display:block}`);
      rules.push(
        `#rr-tab-${i}-${t}:checked ~ .tabs .tab-${t}{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(15,23,42,.08)}`,
      );
    }
  }

  rules.push('.tab-panel{display:none}');
  return rules.join('');
}
