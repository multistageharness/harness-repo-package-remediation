// XLSX reader: loads the first worksheet into raw { header, records } using exceljs,
// matching the CSV reader's output shape.
import ExcelJS from 'exceljs';

/** Convert an exceljs row's cell values into a plain array (dropping the 1-based leading slot). */
function rowToArray(row) {
  // exceljs row.values is a 1-based array whose index 0 is always empty.
  const values = Array.isArray(row.values) ? row.values.slice(1) : [];
  return values.map((v) => (v === null || v === undefined ? '' : v));
}

/** @type {import('../contracts.mjs').Reader} */
export const xlsxReader = {
  id: 'xlsx',

  canRead(source) {
    return /\.xlsx$/i.test(source.filename || source.path || '');
  },

  async read(source) {
    const workbook = new ExcelJS.Workbook();
    if (source.path) {
      await workbook.xlsx.readFile(source.path);
    } else if (source.buffer) {
      await workbook.xlsx.load(source.buffer);
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return { header: [], records: [] };
    }

    const rows = [];
    sheet.eachRow((row) => {
      rows.push(rowToArray(row));
    });

    if (rows.length === 0) {
      return { header: [], records: [] };
    }

    return { header: rows[0], records: rows.slice(1) };
  },
};
