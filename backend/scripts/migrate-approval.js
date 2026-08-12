/**
 * FR-012 migration script — backfills the embedded `approval` structure on
 * LEGACY request documents.
 *
 * Additive + idempotent: documents that already carry `approval` are skipped;
 * nothing is ever deleted or overwritten. Historical approvers are never
 * fabricated (approvedBy/rejectedBy stay null when unknown).
 *
 * Usage:  node scripts/migrate-approval.js
 */

const mongoose = require("mongoose");
require("dotenv").config();

const { createConfig } = require("../src/infrastructure/config");
const { deriveApprovalFromLegacy } = require("../src/domain/approval-migration");

(async () => {
  const config = createConfig();
  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.getClient().db();
  const requests = db.collection("requests");

  const cursor = requests.find({ approval: { $exists: false } });
  let updated = 0;
  let skipped = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const approval = deriveApprovalFromLegacy(doc);
    if (!approval) {
      skipped += 1;
      continue;
    }
    await requests.updateOne(
      { _id: doc._id },
      { $set: { approval } },
      { upsert: false }
    );
    updated += 1;
  }

  console.log(`[migrate-approval] updated=${updated} skipped=${skipped}`);
  await mongoose.disconnect();
  console.log("[migrate-approval] complete");
})().catch((err) => {
  console.error("[migrate-approval] FAILED", err);
  process.exit(1);
});
