/**
 * keys.ts — stable, collision-free React keys for lists whose items carry no natural id.
 *
 * Three of the report's lists genuinely have no unique field to key on, and it is not laziness:
 *
 *   - LOG LINES — two stages can legitimately emit the same message at the same derived timestamp.
 *   - DIFF LINES — the same line of text can repeat within one hunk; that is what a diff IS.
 *   - APPLIED-CHANGES ROWS — the same package can appear twice with different scopes.
 *
 * The reflex is `key={i}`, which linters rightly flag: an index key is a bug waiting for the list to
 * be reordered or spliced. Rather than suppress the rule, this derives a key from the item's CONTENT
 * and disambiguates genuine duplicates with an occurrence counter. The result is unique, stable
 * across renders, and independent of position — so it stays correct even if these lists ever do get
 * sorted or filtered, which is exactly the property the index key lacks.
 */

/** Pair each item with a content-derived key, suffixing duplicates with their occurrence number. */
export function withKeys<T>(items: T[], id: (item: T) => string): Array<{ item: T; key: string }> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = id(item);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { item, key: n === 1 ? base : `${base}#${n}` };
  });
}
