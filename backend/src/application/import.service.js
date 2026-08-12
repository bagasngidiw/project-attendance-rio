/**
 * ImportService — bulk user import orchestration (FR-061).
 *
 * Parses CSV/JSON content, validates every row against the platform password
 * policy + role registry, and provisions ACTIVE accounts with a policy-
 * compliant temporary credential behind the `mustChangePassword` gate. A row
 * failure never aborts the batch; per-row errors are collected and surfaced.
 * A single USERS.IMPORTED audit event summarizes the run.
 *
 * EMAIL/TEMP-CREDENTIAL SEAM: the temporary password is never returned; in
 * production it is delivered out-of-band (email/HR comms). If the password
 * policy makes a compliant temporary credential unfeasible for a row, the
 * account cannot be created here and the row is reported — the user can be
 * onboarded later through the self-service recovery flow (FR-045).
 */

const crypto = require("crypto");
const { parseImportRows, validateImportRow } = require("../domain/import");
const { validatePassword } = require("../domain/password-policy");
const { ValidationError } = require("../domain/errors");

const TEMP_PASSWORD_PREFIX = "Temporary2026!";

const SUFFIX_POOL =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CHAR_CLASSES = Object.freeze({
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  digit: "0123456789",
  special: "!@#$%^&*()_+-=[]{}|;:,.<>?",
});

function randomFrom(pool) {
  return pool[crypto.randomBytes(1)[0] % pool.length];
}

function shuffle(chars) {
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

class ImportService {
  /**
   * @param {object} deps
   * @param {import('../infrastructure/repositories/user.repository').UserRepository} deps.userRepository
   * @param {import('../infrastructure/repositories/role.repository').RoleRepository} deps.roleRepository
   * @param {import('../infrastructure/repositories/user-role.repository').UserRoleRepository} deps.userRoleRepository
   * @param {import('../infrastructure/password-hasher').BcryptPasswordHasher} deps.passwordHasher
   * @param {import('./password.service').PasswordService} deps.passwordService
   * @param {import('./audit.service').AuditService} deps.auditService
   */
  constructor({
    userRepository,
    roleRepository,
    userRoleRepository,
    passwordHasher,
    passwordService,
    auditService,
  }) {
    this.userRepository = userRepository;
    this.roleRepository = roleRepository;
    this.userRoleRepository = userRoleRepository;
    this.passwordHasher = passwordHasher;
    this.passwordService = passwordService;
    this.auditService = auditService;
  }

  /**
   * Generates a policy-compliant temporary credential: `Temporary2026!` plus a
   * random suffix (meets the default complexity rules); falls back to a
   * purpose-built compliant password when the prefix form cannot satisfy the
   * policy.
   *
   * @param {object} policy normalized password policy
   * @returns {Promise<string>} compliant temporary password
   */
  async generateTemporaryPassword(policy) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const suffix = Array.from(crypto.randomBytes(6))
        .map((byte) => SUFFIX_POOL[byte % SUFFIX_POOL.length])
        .join("");
      const candidate = `${TEMP_PASSWORD_PREFIX}${suffix}`;
      const { valid } = validatePassword(policy, candidate);
      if (valid) return candidate;
    }
    return this.generateCompliantPassword(policy);
  }

  /** Builds a password from the policy's required character classes. */
  generateCompliantPassword(policy) {
    const required = [];
    if (policy.requireUppercase) required.push(CHAR_CLASSES.uppercase);
    if (policy.requireLowercase) required.push(CHAR_CLASSES.lowercase);
    if (policy.requireDigit) required.push(CHAR_CLASSES.digit);
    if (policy.requireSpecial) required.push(CHAR_CLASSES.special);
    const all = required.join("");
    const length = Math.max(policy.minLength, required.length);
    const chars = [];
    for (let i = 0; i < length; i += 1) {
      const pool = i < required.length ? required[i] : all;
      chars.push(randomFrom(pool));
    }
    return shuffle(chars).join("");
  }

  /**
   * Imports a batch of users. Row-level parse/validation/runtime failures are
   * collected and never abort the batch.
   *
   * @param {{ rawText: string, format: "csv"|"json", actor?: object }} input
   * @returns {Promise<{ created: number, failed: number, errors: Array<{ rowNumber: number, message: string }> }>}
   */
  async importUsers({ rawText, format, actor = {} }) {
    const { rows, errors: parseErrors } = parseImportRows(rawText, format);

    const policy = await this.passwordService.getPasswordPolicy();
    const roles = await this.roleRepository.listActive();

    const seenUsernames = new Set();
    const rowErrors = [...parseErrors];
    const created = [];

    for (const { rowNumber, values } of rows) {
      const validation = validateImportRow(values, {
        roles,
        seenUsernames,
      });
      if (!validation.valid) {
        rowErrors.push({ rowNumber, message: validation.errors.join("; ") });
        continue;
      }

      const role = roles.find(
        (r) => String(r.key).trim().toUpperCase() === validation.roleKey
      );
      if (!role) {
        rowErrors.push({
          rowNumber,
          message: `roleKey "${validation.roleKey}" is not a valid role.`,
        });
        continue;
      }

      try {
        const tempPassword = await this.generateTemporaryPassword(policy);
        const passwordHash = await this.passwordHasher.hash(tempPassword);
        const user = await this.userRepository.create({
          username: validation.username,
          email: validation.email,
          name: validation.name,
          passwordHash,
          status: "ACTIVE",
          mustChangePassword: true,
        });
        await this.userRoleRepository.replaceRolesForUser(
          user.id,
          [role.id],
          actor.actorId ?? null
        );
        created.push({ rowNumber, userId: user.id, username: user.username });
      } catch (err) {
        rowErrors.push({
          rowNumber,
          message: err.message || "User could not be created.",
        });
      }
    }

    await this.auditService.record({
      action: "USERS.IMPORTED",
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "IMPORT", id: null, summary: `bulk-${format}` },
      outcome: "SUCCESS",
      metadata: {
        created: created.length,
        failed: rowErrors.length,
        total: rows.length,
      },
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return {
      created: created.length,
      failed: rowErrors.length,
      errors: rowErrors.map((e) => ({ rowNumber: e.rowNumber, message: e.message })),
    };
  }
}

module.exports = { ImportService, TEMP_PASSWORD_PREFIX };
