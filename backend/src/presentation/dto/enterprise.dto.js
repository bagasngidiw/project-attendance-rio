/**
 * Enterprise config DTO (FR-039) — validated at the HTTP boundary; the service
 * normalizer remains the source of truth for defaults/merging.
 */

const { z } = require("zod");

const enterpriseConfigDto = z.object({
  brand: z
    .object({
      companyName: z.string().max(256).optional(),
      logoUrl: z.string().max(2048).optional(),
    })
    .optional(),
  timezone: z.string().max(64).optional(),
  defaults: z.record(z.string(), z.unknown()).optional(),
});

module.exports = { enterpriseConfigDto };
