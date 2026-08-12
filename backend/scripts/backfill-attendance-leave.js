/**
 * FR-001 backfill script — creates LEAVE attendance records for every date
 * covered by an existing APPROVED LEAVE request where no attendance record
 * exists for that `{userId, date}`.
 *
 * Non-destructive + idempotent: existing attendance records are NEVER
 * overwritten and no dates outside the approved request range are fabricated.
 * Re-run safely at any time.
 *
 * Usage:  node scripts/backfill-attendance-leave.js
 */

const mongoose = require("mongoose");
require("dotenv").config();

const { createConfig } = require("../src/infrastructure/config");

/** Inclusive iteration of YYYY-MM-DD date keys between two bounds. */
function enumerateDateKeys(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return dates;
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

(async () => {
  const config = createConfig();
  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.getClient().db();
  const requests = db.collection("requests");
  const attendance = db.collection("attendances");

  const cursor = requests.find({
    type: "LEAVE",
    status: "APPROVED",
    "payload.startDate": { $type: "string" },
    "payload.endDate": { $type: "string" },
  });

  let created = 0;
  let skippedExisting = 0;
  let requestCount = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const startDate = doc.payload?.startDate;
    const endDate = doc.payload?.endDate;
    if (!startDate || !endDate) continue;

    requestCount += 1;
    for (const date of enumerateDateKeys(startDate, endDate)) {
      const existing = await attendance.findOne({
        userId: doc.requesterId,
        date,
      });
      if (existing) {
        skippedExisting += 1;
        continue;
      }
      await attendance.insertOne({
        userId: doc.requesterId,
        date,
        clockInAt: null,
        clockOutAt: null,
        source: "SELF",
        exceptionTypes: [],
        status: "LEAVE",
        punctuality: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      created += 1;
    }
  }

  console.log(
    `[backfill-attendance-leave] requests=${requestCount} created=${created} skippedExisting=${skippedExisting}`
  );
  await mongoose.disconnect();
  console.log("[backfill-attendance-leave] complete");
})().catch((err) => {
  console.error("[backfill-attendance-leave] FAILED", err);
  process.exit(1);
});
