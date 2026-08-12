/**
 * Reporting-line DTOs (FR-043).
 */

const { z } = require("zod");

const assignManagerDto = z.object({
  managerId: z.string().min(1).nullable(),
});

module.exports = { assignManagerDto };
