/**
 * Report exporter tests (FR-018 §3.4): Excel-compatible CSV (BOM + escaping)
 * and dependency-free PDF rendering (header, footer, pagination).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { renderCsv, csvCell } = require("../../src/infrastructure/exporters/csv.exporter");
const { renderPdf } = require("../../src/infrastructure/exporters/pdf.exporter");
const { renderExcel } = require("../../src/infrastructure/exporters/excel.exporter");

const TYPE = {
  columns: ["employee", "date", "status"],
};

const ROWS = [
  { employee: "Jane Doe", date: "2026-08-06", status: "NORMAL" },
  { employee: "Bob, \"Quoted\"", date: "2026-08-06", status: "EXCEPTION" },
];

test("csvCell quotes values containing commas/quotes and escapes quotes", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), "\"a,b\"");
  assert.equal(csvCell("say \"hi\""), "\"say \"\"hi\"\"\"");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(0), "0");
});

test("renderCsv emits a UTF-8 BOM, header, and escaped rows (F2)", () => {
  const csv = renderCsv({ type: TYPE, rows: ROWS });
  assert.ok(csv.startsWith("\uFEFF"), "BOM present for Excel compatibility");
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], "employee,date,status");
  assert.equal(lines[1], "Jane Doe,2026-08-06,NORMAL");
  assert.equal(lines[2], "\"Bob, \"\"Quoted\"\"\",2026-08-06,EXCEPTION");
});

test("renderPdf produces a valid PDF with header, footer, and content (F2)", () => {
  const pdf = renderPdf({
    title: "Laporan Absensi",
    generatedAt: "2026-08-06T10:00:00.000Z",
    filterSummary: "from=2026-08-01",
    exportedBy: "hradmin",
    type: TYPE,
    rows: ROWS,
  });

  assert.ok(pdf.startsWith("%PDF-1.4"), "PDF header");
  assert.ok(pdf.includes("Laporan Absensi"), "report title in the stream");
  assert.ok(pdf.includes("Jane Doe"), "row content present");
  assert.ok(pdf.includes("Page 1 of 1"), "footer page numbers");
  assert.ok(pdf.includes("Exported by: hradmin"), "footer exported-by");
  assert.ok(pdf.includes("trailer"), "trailer present");
  assert.ok(pdf.trimEnd().endsWith("%%EOF"), "EOF marker");
  assert.ok(pdf.includes("xref"), "xref table present");
});

test("renderPdf paginates large result sets into multiple pages (F2)", () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({
    employee: `Employee ${i}`,
    date: "2026-08-06",
    status: "NORMAL",
  }));
  const pdf = renderPdf({
    title: "Big Report",
    generatedAt: "2026-08-06T10:00:00.000Z",
    filterSummary: "all",
    exportedBy: "hradmin",
    type: TYPE,
    rows,
  });

  // Multiple pages -> "Page X of Y" with Y > 1.
  const footerMatch = pdf.match(/Page \d+ of (\d+)/);
  assert.ok(footerMatch, "footer present");
  assert.ok(Number(footerMatch[1]) > 1, `expected multiple pages, got ${footerMatch[1]}`);
  const pageObjects = (pdf.match(/\/Type \/Page\b/g) ?? []).length;
  assert.equal(pageObjects, Number(footerMatch[1]), "page objects match page count");
});

test("renderExcel produces a real .xlsx workbook with headers and values (FR-005)", async () => {
  const labels = { employee: "Karyawan", date: "Tanggal", status: "Status" };
  const buffer = await renderExcel({
    type: { columns: ["employee", "date", "status"], label: "Absensi" },
    rows: ROWS,
    columnLabels: labels,
    title: "Laporan Absensi",
    generatedAt: "2026-08-06T10:00:00.000Z",
  });

  assert.ok(Buffer.isBuffer(buffer), "writeBuffer returns a Buffer");
  assert.ok(buffer.subarray(0, 2).toString("latin1") === "PK", "xlsx zip signature");
  assert.ok(buffer.length > 500, "workbook has real content");

  // Round-trip: parse the buffer and assert headers + values survived.
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("Absensi");
  assert.ok(sheet, "worksheet named after the report label");
  assert.equal(sheet.getCell("A2").value, "Karyawan", "header row uses Indonesian label");
  assert.equal(sheet.getCell("A3").value, "Jane Doe", "data row value");
  assert.equal(sheet.getCell("B3").value, "2026-08-06", "date value preserved");
});
