/**
 * show-access-collections.js — standalone inspection tool for website-access
 * data collections (roles, users, permissions, role_permissions, user_roles
 * and the SUPER_ADMIN menu tree).
 *
 * Connects to the configured MongoDB (config.mongoUri — the current Atlas
 * cluster), ensures the access collections exist and are populated by running
 * the existing idempotent seed, then prints a complete human-readable report:
 *
 *   [COLLECTIONS]     every collection present in the connected database
 *   [ROLE]            role key/name/level/scope/status + granted permissions
 *   [USER]            username/name/email/status + resolved role keys
 *   [SUPER_ADMIN MENU] the navigation tree built from SUPER_ADMIN permissions
 *
 * SECURITY: never prints config.mongoUri (contains Atlas credentials) nor any
 * user secret (passwordHash/passwordHistory/...). All user rows pass through
 * `sanitizeUser`.
 *
 * Usage: npm run access:show  (or)  node scripts/show-access-collections.js
 */

require("dotenv").config();

const mongoose = require("mongoose");

const { createConfig } = require("../src/infrastructure/config");
const { buildApp } = require("../server");
const { seedDatabase } = require("../src/infrastructure/seed/seed");
const { BcryptPasswordHasher } = require("../src/infrastructure/password-hasher");
const {
  sanitizeUser,
  roleRow,
  userRow,
  buildMenuTree,
} = require("../src/domain/access-report");

(async () => {
  const config = createConfig();

  // Deliberately print only sanitized connection info — the URI contains
  // credentials and must never appear in output or logs.
  await mongoose.connect(config.mongoUri);
  const host = mongoose.connection.host;
  const dbName = mongoose.connection.name;
  console.log(`[access:show] connected to MongoDB at ${host} (db: ${dbName})`);

  // Ensure the access collections exist and are populated. The seed is
  // idempotent: repeated runs never duplicate roles or users.
  const { repositories } = buildApp(config);
  await seedDatabase({
    roleRepository: repositories.roleRepository,
    permissionRepository: repositories.permissionRepository,
    userRepository: repositories.userRepository,
    leaveTypeRepository: repositories.leaveTypeRepository,
    sicknessTypeRepository: repositories.sicknessTypeRepository,
    approvalConfigurationRepository: repositories.approvalConfigurationRepository,
    passwordHasher: new BcryptPasswordHasher(config.security.bcryptRounds),
    config,
  });

  // ── 1) Collections ────────────────────────────────────────────────────────
  const collections = await mongoose.connection.db.collections();
  const names = collections.map((c) => c.collectionName).sort();
  console.log(`\n[COLLECTIONS] (${names.length})`);
  console.log(names.join(", "));

  // ── 2) Roles + permissions ─────────────────────────────────────────────────
  const roles = await repositories.roleRepository.listAll();
  const roleKeysById = new Map();
  console.log(`\n[ROLES] (${roles.length})`);
  for (const role of roles) {
    roleKeysById.set(String(role.id), role.key);
    const keys = await repositories.permissionRepository.permissionKeysForRole(role.id);
    const row = roleRow(role, keys);
    console.log(
      `[ROLE] key=${row.key} name=${row.name} level=${row.level} scope=${row.dataScope} status=${row.status}`
    );
    if (row.permissions.length > 0) {
      console.log(`  permissions: ${row.permissions.join(", ")}`);
    } else {
      console.log("  permissions: (none)");
    }
  }

  // ── 3) Users + role memberships ────────────────────────────────────────────
  const { items: users } = await repositories.userRepository.list({
    page: 1,
    pageSize: 10000,
  });
  console.log(`\n[USERS] (${users.length})`);
  for (const user of users) {
    const row = userRow(sanitizeUser(user), roleKeysById);
    console.log(
      `[USER] username=${row.username} name=${row.name} email=${row.email} status=${row.status} roles=${row.roles.length > 0 ? row.roles.join(",") : "(none)"}`
    );
  }

  // ── 4) SUPER_ADMIN menu tree ───────────────────────────────────────────────
  console.log("\n[SUPER_ADMIN MENU]");
  const superRole = await repositories.roleRepository.findByKey("SUPER_ADMIN");
  if (!superRole) {
    console.log("SUPER_ADMIN role not found (unexpected after seed).");
  } else {
    const superKeys = await repositories.permissionRepository.permissionKeysForRole(
      superRole.id
    );
    const tree = buildMenuTree([...superKeys]);
    console.log(JSON.stringify(tree, null, 2));
  }

  await mongoose.disconnect();
  console.log("\n[access:show] done.");
})().catch((err) => {
  console.error("[access:show] failed:", err);
  process.exit(1);
});
