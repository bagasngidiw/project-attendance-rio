/**
 * Filter preset DTOs (FR-047). The `filters` payload is a free object whose
 * size is enforced by the domain (≤ 64 KB); the DTO guarantees it is an object.
 */

const { z } = require("zod");
const { FILTER_PRESET_ROUTES } = require("../../domain/filter-preset");

const filterPresetDto = z.object({
  name: z.string().trim().min(1, "A preset name is required.").max(100),
  route: z.enum(FILTER_PRESET_ROUTES),
  filters: z.record(z.string(), z.unknown()),
});

const createFilterPresetDto = filterPresetDto;
const updateFilterPresetDto = filterPresetDto.partial();

module.exports = { createFilterPresetDto, updateFilterPresetDto };
