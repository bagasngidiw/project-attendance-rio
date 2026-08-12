/**
 * PDF exporter (FR-018 §3.4) — a dependency-free, valid PDF generator.
 *
 * Produces a paginated table with a header (report title, generated-at,
 * filter summary) and footer (page numbers, exported-by). Rendered with the
 * built-in Helvetica font; no external PDF library is required.
 */

const PAGE_HEIGHT = 792;
const MARGIN_TOP = 72;
const MARGIN_BOTTOM = 48;
const MARGIN_LEFT = 50;
const LINE_HEIGHT = 13;
const ROWS_PER_PAGE = 45;

/** Escapes a string for a PDF literal string; drops non-Latin-1 characters. */
function escapePdfString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "?");
}

function byteLength(str) {
  return Buffer.byteLength(str, "latin1");
}

/** Builds the content stream for one page: header/footer + body lines. */
function buildContentStream(lines, pageNumber, totalPages, exportedBy) {
  const parts = [];
  let y = PAGE_HEIGHT - MARGIN_TOP;
  for (const line of lines) {
    parts.push(`BT /F1 9 Tf ${MARGIN_LEFT} ${y} Td (${escapePdfString(line)}) Tj ET`);
    y -= LINE_HEIGHT;
  }
  parts.push(`BT /F1 8 Tf ${MARGIN_LEFT} ${MARGIN_BOTTOM} Td (Page ${pageNumber} of ${totalPages}) Tj ET`);
  parts.push(`BT /F1 8 Tf 350 ${MARGIN_BOTTOM} Td (Exported by: ${escapePdfString(exportedBy)}) Tj ET`);
  return parts.join("\n");
}

/**
 * Renders a paginated PDF report.
 *
 * @param {{ title: string, generatedAt: string, filterSummary: string, exportedBy: string, type: { columns: string[] }, rows: object[] }} input
 * @returns {string} PDF payload
 */
function renderPdf({ title, generatedAt, filterSummary, exportedBy, type, rows }) {
  const headerLines = [title, `Generated: ${generatedAt}`, `Filters: ${filterSummary}`];
  const columnHeader = type.columns.join("  |  ");
  const dataLines = rows.map((row) =>
    type.columns.map((col) => String(row[col] ?? "")).join("  |  ")
  );

  // Paginate: page 1 = header + column header + data; later pages = column header + data.
  const pages = [];
  let current = [...headerLines, "", columnHeader];
  for (const line of dataLines) {
    if (current.length >= ROWS_PER_PAGE) {
      pages.push(current);
      current = [columnHeader];
    }
    current.push(line);
  }
  if (current.length > 0) pages.push(current);

  const contentStreams = pages.map((lines, index) =>
    buildContentStream(lines, index + 1, pages.length, exportedBy)
  );

  return assemblePdf(contentStreams);
}

/** Assembles the PDF object graph with a correct xref table. */
function assemblePdf(contentStreams) {
  const objects = new Map();
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const kids = contentStreams.map((_, i) => 4 + i * 2);
  objects.set(
    2,
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`
  );
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  contentStreams.forEach((content, i) => {
    const pageObj = 4 + i * 2;
    const contentObj = pageObj + 1;
    objects.set(
      pageObj,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`
    );
    objects.set(contentObj, `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`);
  });

  let pdf = "%PDF-1.4\n";
  const offsets = new Map();
  for (let i = 1; i <= objects.size; i += 1) {
    offsets.set(i, byteLength(pdf));
    pdf += `${i} 0 obj\n${objects.get(i)}\nendobj\n`;
  }

  const xrefStart = byteLength(pdf);
  pdf += `xref\n0 ${objects.size + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.size; i += 1) {
    pdf += `${String(offsets.get(i)).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.size + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return pdf;
}

module.exports = { renderPdf };
