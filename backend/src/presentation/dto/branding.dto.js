/**
 * Branding DTOs (FR-001) — identity only. Colors are product-controlled and
 * deliberately NOT accepted from customers.
 */

const { z } = require("zod");

const logoReferenceSchema = z
  .object({
    url: z.string().min(1),
    fileName: z.string().nullable().optional(),
    contentType: z.string().nullable().optional(),
    sizeBytes: z.number().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const updateBrandingDto = z.object({
  applicationName: z.string().trim().min(1, "Nama aplikasi wajib diisi.").max(80),
  applicationShortName: z.string().trim().min(1, "Nama singkatan wajib diisi.").max(16),
  logo: logoReferenceSchema,
}).strict();

module.exports = { updateBrandingDto };
