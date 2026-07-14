/**
 * dev/routes.ts — the dev harness's URL grammar. ONE example, ONE path.
 *
 * Every example on both dev pages is addressable, so it can be linked, bookmarked, reloaded, and
 * pasted into a review. Before this file the report's examples lived in a query param
 * (`/?variant=blocked`) and the mock's behind a hash (`/mock/#/blocked`) — neither reads as an
 * address of the thing, and the hash form in particular is invisible to anything that only sees the
 * path.
 *
 *   /              the report, default example (an alias of `/as-run`)
 *   /as-run        the session exactly as the flow emitted it
 *   /blocked       the same repos, every outcome blocked
 *   /empty         the same dataset, zero repositories ingested
 *   /mock/         the design mock, default example
 *   /mock/empty    /mock/blocked    /mock/hidden
 *
 * The report's paths are DERIVED from `VARIANTS` — adding a variant adds its URL, and there is no
 * second list to keep in step. `vite.config.ts` imports the same constants to decide which deep
 * paths serve which document, so the server and the client cannot disagree about what `/blocked` is.
 */
import { DEFAULT_VARIANT, VARIANTS } from './variants';

/** The mock lives on its own DOCUMENT, not a route of the report — see `dev/mock/main.tsx`. */
export const MOCK_BASE = '/mock';

/** `as-run` → `/as-run`. The default variant is ALSO reachable at `/`. */
export function reportPath(variantId: string): string {
  return `/${variantId}`;
}

function isVariant(id: string): boolean {
  return VARIANTS.some((v) => v.id === id);
}

/**
 * The example a URL names. This function IS the grammar — nothing else may parse the URL.
 *
 *   /blocked            → `blocked`     the path names the example
 *   /                   → the default
 *   /?variant=blocked   → `blocked`     a link written before examples had paths still resolves…
 *   /blocked?variant=x  → `blocked`     …but the path always wins where both are present
 *   /nonsense           → the default   an unknown example is not an error worth a blank page
 *
 * The legacy query is only consulted at `/`, and `main.tsx` rewrites it to the path form on arrival.
 * Reading it BEFORE settling on the default is the whole point: `/` resolving to the default first
 * would swallow `?variant=blocked` and show an old link the wrong example, silently.
 */
export function variantFromLocation(pathname: string, search: string): string {
  const slug = pathname.replace(/^\/+|\/+$/g, '');
  if (slug) return isVariant(slug) ? slug : DEFAULT_VARIANT;

  const legacy = new URLSearchParams(search).get('variant');
  return legacy && isVariant(legacy) ? legacy : DEFAULT_VARIANT;
}

/** Every path the REPORT document answers to. The dev server rewrites these to `dev/index.html`. */
export const REPORT_PATHS: string[] = ['/', ...VARIANTS.map((v) => reportPath(v.id))];

/** The mock's examples, in nav order. Paths are relative to `MOCK_BASE` (react-router `basename`). */
export const MOCK_EXAMPLES: { name: string; path: string }[] = [
  { name: 'Default', path: '/' },
  { name: 'Empty', path: '/empty' },
  { name: 'All blocked', path: '/blocked' },
  { name: 'Flag off', path: '/hidden' },
];

/** `/empty` → `/mock/empty` — the address to hand someone, as opposed to the route inside the mock. */
export function mockUrl(path: string): string {
  return path === '/' ? `${MOCK_BASE}/` : `${MOCK_BASE}${path}`;
}
