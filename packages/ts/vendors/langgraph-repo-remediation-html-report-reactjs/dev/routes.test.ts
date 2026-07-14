/**
 * The URL grammar is a contract with every link anyone has ever written down — a bookmark, a review
 * comment, a message. It fails SILENTLY when it breaks: the page still renders, just not the example
 * that was asked for. These cases are here because that is not something a screenshot catches.
 *
 * The `/?variant=blocked` case is not hypothetical — the first cut of this change resolved `/` to
 * the default before it ever looked at the query, so every link written under the old query-param
 * scheme quietly rendered `as-run`.
 */
import { describe, expect, it } from 'vitest';

import { MOCK_EXAMPLES, REPORT_PATHS, mockUrl, reportPath, variantFromLocation } from './routes';
import { DEFAULT_VARIANT, VARIANTS } from './variants';

describe('report example URLs', () => {
  it('gives every variant its own path, and serves them all from the report document', () => {
    for (const v of VARIANTS) {
      expect(reportPath(v.id)).toBe(`/${v.id}`);
      expect(REPORT_PATHS).toContain(`/${v.id}`);
    }
    // `/` is the default example's other address, so a bare visit lands somewhere real.
    expect(REPORT_PATHS).toContain('/');
  });

  it('reads the example out of the path', () => {
    expect(variantFromLocation('/blocked', '')).toBe('blocked');
    expect(variantFromLocation('/empty', '')).toBe('empty');
    // A trailing slash is the same address, not a different one.
    expect(variantFromLocation('/blocked/', '')).toBe('blocked');
  });

  it('still resolves a link written before the examples had paths', () => {
    expect(variantFromLocation('/', '?variant=blocked')).toBe('blocked');
    expect(variantFromLocation('/', '?session=abc123&variant=empty')).toBe('empty');
  });

  it('lets the path win when a stale query contradicts it', () => {
    expect(variantFromLocation('/blocked', '?variant=empty')).toBe('blocked');
  });

  it('falls back to the default rather than rendering nothing', () => {
    expect(variantFromLocation('/', '')).toBe(DEFAULT_VARIANT);
    expect(variantFromLocation('/nonsense', '')).toBe(DEFAULT_VARIANT);
    expect(variantFromLocation('/', '?variant=nonsense')).toBe(DEFAULT_VARIANT);
  });
});

describe('mock example URLs', () => {
  it('addresses every example under /mock/, never at the report’s root', () => {
    for (const e of MOCK_EXAMPLES) {
      expect(mockUrl(e.path)).toMatch(/^\/mock\//);
    }
    expect(mockUrl('/')).toBe('/mock/');
    expect(mockUrl('/blocked')).toBe('/mock/blocked');
  });

  it('keeps the mock’s paths clear of the report’s', () => {
    // `/blocked` is the REPORT's blocked example; the mock's is `/mock/blocked`. If these ever
    // collided, one of the two pages would be unreachable at its own address.
    for (const e of MOCK_EXAMPLES) {
      expect(REPORT_PATHS).not.toContain(mockUrl(e.path));
    }
  });
});
