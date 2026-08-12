/**
 * CSV exporter (FR-018 §3.4) — Excel-compatible CSV with a UTF-8 BOM and
 * proper escaping of commas, quotes, and newlines.
 */

/** Escapes a single cell for CSV (quote-wrap when the value contains specials). */
function csvCell(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Renders the projected rows as Excel-compatible CSV.
 *
 * @param {{ type: { columns: string[] }, rows: object[] }} input
 * @returns {string} CSV payload with BOM
 */
function renderCsv({ type, rows }) {
  const header = type.columns.join(",");
  const body = rows.map((row) => type.columns.map((col) => csvCell(row[col])).join(","));
  return `\uFEFF${[header, ...body].join("\r\n")}`;
}

module.exports = { renderCsv, csvCell };
