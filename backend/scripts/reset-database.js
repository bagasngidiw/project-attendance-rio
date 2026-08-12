/**
 * reset-database.js — destructive maintenance script.
 *
 * Drops the ENTIRE database and re-provisions ONLY the minimal SUPER_ADMIN
 * setup: the permission registry (so the role can resolve every menu), the
 * SUPER_ADMIN role (granted every permission), and the superadmin account.
 * All other roles, demo users, requests, attendance, master data, approval
 * configurations, audit logs and settings are removed.
 *
 * After this script the server must boot with SEED_DEMO_DATA=false (see .env)
 * so the demo data is not re-created on the next start.
 *
 * Usage: npm run db:reset  (or)  node scripts/reset-database.js
 */

require("dotenv").config();

const mongoose = require("mongoose");

const { createConfig } = require("../src/infrastructure/config");
const { buildApp } = require("../server");
const { seedDatabase } = require("../src/infrastructure/seed/seed");
const { BcryptPasswordHasher } = require("../src/infrastructure/password-hasher");

(async () => {
  const config = createConfig();
  const uri = config.mongoUri;
  console.log(`[db:reset] target: ${uri}`);

  await mongoose.connect(uri);

  const collections = await mongoose.connection.db.collections();
  const names = collections.map((c) => c.collectionName);
  console.log(`[db:reset] dropping ${names.length} collection(s): ${names.join(", ")}`);
  await mongoose.connection.dropDatabase();
  console.log("[db:reset] database dropped.");

  const { repositories } = buildApp(config);

  // demoData=false keeps ONLY: permission registry + SUPER_ADMIN role (all
  // permissions) + superadmin account. Nothing else is provisioned.
  await seedDatabase({
    roleRepository: repositories.roleRepository,
    permissionRepository: repositories.permissionRepository,
    userRepository: repositories.userRepository,
    leaveTypeRepository: repositories.leaveTypeRepository,
    sicknessTypeRepository: repositories.sicknessTypeRepository,
    approvalConfigurationRepository: repositories.approvalConfigurationRepository,
    passwordHasher: new BcryptPasswordHasher(config.security.bcryptRounds),
    config: {
      ...config,
      seed: { ...config.seed, demoData: false },
    },
  });

  const after = await mongoose.connection.db.collections();
  console.log(
    `[db:reset] remaining collections: ${after.map((c) => c.collectionName).join(", ")}`
  );

  const { UserModel } = require("../src/infrastructure/models/user.model");
  const { RoleModel } = require("../src/infrastructure/models/role.model");
  const users = await UserModel.countDocuments();
  const roles = await RoleModel.countDocuments();
  const admin = await UserModel.findOne({ username: config.seed.superAdminUsername }).lean();
  console.log(
    `[db:reset] done. users=${users}, roles=${roles}, superadmin=${
      admin ? `${admin.username} (must change password on first login)` : "MISSING!"
    }`
  );

  await mongoose.disconnect();
})().catch((err) => {
  console.error("[db:reset] failed:", err);
  process.exit(1);
});
