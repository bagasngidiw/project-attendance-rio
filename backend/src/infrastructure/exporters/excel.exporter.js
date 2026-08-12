/**
 * Excel exporter (FR-005) — renders report rows into a real .xlsx workbook via
 * `exceljs`. The user explicitly requested real Excel files (not CSV).
 *
 * `exceljs` is CommonJS-compatible and `writeBuffer()` returns a Promise, so
 * callers must `await` the result before streaming it to the client.
 */

const ExcelJS = require("exceljs");

/**
 * Renders projected rows as an .xlsx workbook buffer.
 *
 * @param {{ type: { columns: string[], label?: string }, rows: object[], columnLabels: Record<string,string>, title: string, generatedAt: string }} input
 * @returns {Promise<Buffer>}
 */
async function renderExcel({ type, rows, columnLabels, title, generatedAt }) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(type.label ?? "Laporan");
  sheet.columns = type.columns.map((column) => ({
    header: columnLabels[column] ?? column,
    key: column,
    width: 18,
  }));

  // A title row on top keeps the workbook readable in Excel.
  sheet.insertRow(1, [title]);
  sheet.getRow(1).font = { bold: true, size: 12 };

  for (const row of rows) {
    const values = {};
    for (const column of type.columns) {
      const value = row[column];
      values[column] = value === null || value === undefined ? "" : value;
    }
    sheet.addRow(values);
  }

  // Bold header row (row 2 after the title row).
  const headerRow = sheet.getRow(2);
  headerRow.font = { bold: true };

  sheet.views = [{ state: "frozen", ySplit: 2 }];

  return workbook.xlsx.writeBuffer();
}

module.exports = { renderExcel };
