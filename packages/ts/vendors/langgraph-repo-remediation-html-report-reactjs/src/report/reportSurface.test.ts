/**
 * reportSurface.test.ts — the emitted page must LOOK like what this package renders.
 *
 * `check:report` proves the page's MARKUP came from this tree, and for a long time that was the
 * whole of the claim "the React package renders repo-remediation.html". It isn't. A page is what it
 * renders, and half of that is the stylesheet — so a report could ship correct markup painted by a
 * stale bundle and every gate stayed green. Both defects reported against this report so far (a dark
 * diff, then a dark prompt) lived entirely in the CSS.
 *
 * These run against the COMMITTED golden fixture rather than a session under `.harness`, so they
 * gate on a fresh clone with no run on disk — `check:report` covers the real sessions when they
 * exist, and skipping quietly is how "verified" comes to mean "never actually checked".
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extractStyle } from '../../dev/sessions.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const generator = join(here, '..', '..', '..', 'langgraph-repo-remediation-html-report-generator');

const source = readFileSync(join(here, 'report.css'), 'utf8');
const bundled = readFileSync(join(generator, 'vendor', 'report.css'), 'utf8');
const golden = readFileSync(join(generator, 'test', 'fixtures', 'golden-report.html'), 'utf8');

/** Pull one rule's declaration block out of the stylesheet. */
function rule(css: string, selector: string): string {
  const m = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no \`${selector}\` rule in the stylesheet`);
  return m[1];
}

describe('the emitted page is painted by this package', () => {
  it('ships the committed bundle stylesheet, byte for byte', () => {
    // Not "contains our rules" — IS our stylesheet. A stale bundle is the failure this catches, and
    // a subset check would pass on one.
    expect(extractStyle(golden)).toBe(bundled);
  });

  it('declares color-scheme: light in the head, so a dark-mode UA leaves it alone', () => {
    expect(golden).toContain('<meta name="color-scheme" content="light">');
  });
});

describe('every code surface declares its own background', () => {
  // The regression guard for both reported defects. `.dl-add`/`.dl-del` always declared a background;
  // the surfaces AROUND them did not, so anything repainting the page dark darkened exactly the
  // undeclared ones and left the two declared rows light. Inheriting a background is not "white" —
  // it is "whatever the browser decides", and on `file://` that turned out not to be white.
  it.each(['.diff', '.diff pre', '.prompt', '.dl-ctx'])('%s sets a background', (selector) => {
    expect(rule(source, selector)).toMatch(/background\s*:/);
  });

  it('declares color-scheme: light on :root', () => {
    expect(rule(source, ':root')).toMatch(/color-scheme\s*:\s*light/);
  });

  it('keeps the light palette light — the diff and prompt surfaces are the card colour', () => {
    for (const selector of ['.diff', '.prompt']) {
      expect(rule(source, selector)).toMatch(/background\s*:\s*var\(--card\)/);
    }
  });
});
