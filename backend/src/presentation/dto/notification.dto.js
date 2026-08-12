/**
 * Notification DTOs (FR-015) — preferences update.
 */

const { z } = require("zod");

const updatePreferencesDto = z.object({
  optOutTypes: z.array(z.string().min(1)).default([]),
});

module.exports = { updatePreferencesDto };
