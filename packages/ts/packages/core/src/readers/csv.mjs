// CSV reader: turns a CSV source into raw { header, records } using csv-parse.
// No shell, no eval — pure in-process parsing.
import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

/** @type {import('../contracts.mjs').Reader} */
export const csvReader = {
  id: 'csv',

  canRead(source) {
    return /\.csv$/i.test(source.filename || source.path || '');
  },

  async read(source) {
    let text;
    if (source.buffer) {
      text = new TextDecoder().decode(source.buffer);
    } else if (source.path) {
      text = await readFile(source.path, 'utf8');
    } else {
      text = '';
    }

    const rows = parse(text, { relax_column_count: true });
    const header = rows.length > 0 ? rows[0] : [];
    const records = rows.slice(1);
    return { header, records };
  },
};
