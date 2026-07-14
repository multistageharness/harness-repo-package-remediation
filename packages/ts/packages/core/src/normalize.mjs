// Convert raw { header, records } into keyed Row objects with a deterministic header policy.
import { diagnostic } from './diagnostics.mjs';
import { CODES } from './contracts.mjs';

/**
 * @param {{ header: string[], records: unknown[][] }} raw
 * @param {import('./contracts.mjs').IngestOptions} [opts]
 * @param {{ add(d: object): void }} [diagnostics]
 * @returns {{ rows: import('./contracts.mjs').Row[], fields: string[] }}
 */
export function normalize({ header, records }, opts = {}, diagnostics = { add() {} }) {
  // headers === false: the first row is data, not a header. Synthesize col_1..col_n.
  if (opts.headers === false) {
    const data = [header, ...records];
    const width = Array.isArray(header) ? header.length : 0;
    const fields = Array.from({ length: width }, (_, i) => `col_${i + 1}`);
    const rows = data.map((rec) => toRow(fields, rec));
    return { rows, fields };
  }

  const source = Array.isArray(header) ? header : [];
  const seen = new Map();
  const fields = source.map((raw, i) => {
    let name = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();

    if (name === '') {
      name = `col_${i + 1}`;
      diagnostics.add(
        diagnostic({
          severity: 'warning',
          code: CODES.HEADER_FIXED,
          message: `Blank header at column ${i + 1} renamed to "${name}".`,
          at: { column: i + 1 },
        }),
      );
    }

    const count = seen.get(name) ?? 0;
    if (count > 0) {
      const deduped = `${name}_${count + 1}`;
      diagnostics.add(
        diagnostic({
          severity: 'warning',
          code: CODES.HEADER_FIXED,
          message: `Duplicate header "${name}" renamed to "${deduped}".`,
          at: { column: i + 1 },
        }),
      );
      seen.set(name, count + 1);
      name = deduped;
    } else {
      seen.set(name, 1);
    }

    return name;
  });

  const rows = records.map((rec) => toRow(fields, rec));
  return { rows, fields };
}

function toRow(fields, rec) {
  const record = Array.isArray(rec) ? rec : [];
  return Object.fromEntries(fields.map((f, i) => [f, record[i]]));
}
