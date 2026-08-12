/**
 * Retention policy DTO (FR-040) — validated at the HTTP boundary; the domain
 * normalizer remains the source of truth for merge/type rules.
 */

const { z } = require("zod");

const retentionDays = z.union([z.number().int().min(0), z.null()]);

const legalHoldRef = z.object({
  type: z.string().min(1),
  id: z.string().min(1),
});

const retentionPolicyDto = z.object({
  auditEventsDays: retentionDays.optional(),
  activityLogsDays: retentionDays.optional(),
  attachmentsDays: retentionDays.optional(),
  requestsDays: retentionDays.optional(),
  usersDays: retentionDays.optional(),
  legalHold: z.array(legalHoldRef).optional(),
});

module.exports = { retentionPolicyDto };
