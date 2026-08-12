/**
 * Calendar routes (FR-059) — holiday CRUD guarded by
 * `calendar:manage_holidays`; the calendar and working-day views are
 * authenticated but readable by any signed-in user.
 */

const { Router } = require("express");
const { createHolidayDto, updateHolidayDto } = require("../dto/calendar.dto");
const { validate } = require("./auth.routes");

function createCalendarRoutes({ calendarController, authenticate, authorize }) {
  const router = Router();

  router.get("/holidays", authenticate, calendarController.listHolidays);
  router.post(
    "/holidays",
    authenticate,
    authorize("calendar:manage_holidays"),
    validate(createHolidayDto),
    calendarController.createHoliday
  );
  router.patch(
    "/holidays/:id",
    authenticate,
    authorize("calendar:manage_holidays"),
    validate(updateHolidayDto),
    calendarController.updateHoliday
  );
  router.post(
    "/holidays/:id/deactivate",
    authenticate,
    authorize("calendar:manage_holidays"),
    calendarController.deactivateHoliday
  );
  router.post(
    "/holidays/:id/activate",
    authenticate,
    authorize("calendar:manage_holidays"),
    calendarController.activateHoliday
  );
  router.get("/working-days", authenticate, calendarController.workingDays);

  return router;
}

module.exports = { createCalendarRoutes };
