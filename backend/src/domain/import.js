/**
 * Bulk user import domain model (FR-061).
 *
 * Pure, framework-free parsing + row validation. The importer tolerates BOM
 * and CRLF in CSV input, enforces strict column counts, and validates every
 * data row (required fields, email shape, role existence, batch-level username
 * uniqueness) so a single bad row never aborts the batch.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const IMPORT_COLUMNS = Object.freeze(["username", "email", "name", "roleKey"]);

const EMPTY_LINE_RE = /^[ \t]*$/;

/**
 * Splits raw text into lines, tolerating CRLF and stripping a UTF-8 BOM and
 * trailing blank lines.
 *
 * @param {string} rawText
 * @returns {string[]} lines
 */
function normalizeLines(rawText) {
  const text = String(rawText ?? "").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && EMPTY_LINE_RE.test(lines[lines.length - 1])) {
    lines.pop();
  }
  return lines;
}

/**
 * Parses a single CSV line into fields, honoring double-quoted fields and
 * escaped quotes (`""`). Unquoted values are trimmed.
 *
 * @param {string} line
 * @returns {string[]} fields
 */
function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parses import payload text into normalized rows.
 *
 * @param {string} rawText
 * @param {"csv"|"json"} format
 * @returns {{ rows: Array<{ rowNumber: number, values: object }>, errors: Array<{ rowNumber: number, message: string }> }}
 */
function parseImportRows(rawText, format) {
  if (format === "json") return parseJsonRows(rawText);
  return parseCsvRows(rawText);
}

function parseCsvRows(rawText) {
  const errors = [];
  const lines = normalizeLines(rawText);
  if (lines.length === 0) {
    return { rows: [], errors: [{ rowNumber: 1, message: "The CSV is empty." }] };
  }

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const headerValid =
    header.length === IMPORT_COLUMNS.length &&
    header.every((h, i) => h === IMPORT_COLUMNS[i].toLowerCase());
  if (!headerValid) {
    return {
      rows: [],
      errors: [
        {
          rowNumber: 1,
          message: `CSV header must be ${IMPORT_COLUMNS.join(",")}.`,
        },
      ],
    };
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const rowNumber = i + 1;
    const fields = parseCsvLine(lines[i]);
    if (fields.length !== IMPORT_COLUMNS.length) {
      errors.push({
        rowNumber,
        message: `Expected ${IMPORT_COLUMNS.length} columns but found ${fields.length}.`,
      });
      continue;
    }
    const values = {};
    for (let c = 0; c < IMPORT_COLUMNS.length; c += 1) {
      values[IMPORT_COLUMNS[c]] = fields[c];
    }
    rows.push({ rowNumber, values });
  }

  return { rows, errors };
}

function parseJsonRows(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      rows: [],
      errors: [{ rowNumber: 0, message: "Content is not valid JSON." }],
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      rows: [],
      errors: [{ rowNumber: 0, message: "JSON content must be an array of user objects." }],
    };
  }

  const rows = [];
  const errors = [];
  parsed.forEach((entry, index) => {
    const rowNumber = index + 1;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push({ rowNumber, message: "Row must be an object with username, email, name and roleKey." });
      return;
    }
    rows.push({ rowNumber, values: entry });
  });

  return { rows, errors };
}

/** True when `roleKey` matches a key in the provided roles list. */
function roleExists(roleKey, roles) {
  if (!Array.isArray(roles)) return false;
  return roles.some((role) => {
    const key = typeof role === "string" ? role : role?.key;
    return String(key).trim().toUpperCase() === roleKey;
  });
}

/**
 * Validates a single import row.
 *
 * @param {object} row raw row values
 * @param {{ roles: Array<object|string>, seenUsernames?: Set<string> }} options
 *   `seenUsernames` enables batch-level duplicate detection (the set is
 *   updated with each validated username).
 * @returns {{ valid: boolean, errors: string[], username: string, email: string, name: string, roleKey: string }}
 */
function validateImportRow(row, { roles, seenUsernames = null } = {}) {
  const errors = [];
  const username = String(row.username ?? "").trim().toLowerCase();
  const email = String(row.email ?? "").trim().toLowerCase();
  const name = String(row.name ?? "").trim();
  const roleKey = String(row.roleKey ?? "").trim().toUpperCase();

  if (!username) errors.push("username is required.");
  else if (username.length > 64) errors.push("username must be at most 64 characters.");
  if (!email) errors.push("email is required.");
  else if (!EMAIL_PATTERN.test(email)) errors.push("email must be a valid email address.");
  if (!name) errors.push("name is required.");
  else if (name.length > 128) errors.push("name must be at most 128 characters.");
  if (!roleKey) errors.push("roleKey is required.");
  else if (!roleExists(roleKey, roles)) {
    errors.push(`roleKey "${roleKey}" is not a valid role.`);
  }

  if (seenUsernames && username) {
    if (seenUsernames.has(username)) {
      errors.push(`username "${username}" is duplicated within the batch.`);
    } else {
      seenUsernames.add(username);
    }
  }

  return { valid: errors.length === 0, errors, username, email, name, roleKey };
}

module.exports = {
  IMPORT_COLUMNS,
  normalizeLines,
  parseCsvLine,
  parseImportRows,
  roleExists,
  validateImportRow,
};
