/**
 * ConfigProvider — central access to runtime configuration.
 *
 * Values come from environment variables with hardened production defaults.
 * Nothing sensitive is ever logged or exposed through this provider.
 */

function readEnv(name, defaultValue) {
  const value = process.env[name];
  return value === undefined || value === "" ? defaultValue : value;
}

function readNumber(name, defaultValue) {
  const parsed = Number(readEnv(name, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function createConfig() {
  const config = {
    port: readNumber("PORT", 5000),
    mongoUri: readEnv(
      "MONGO_URI",
      "mongodb+srv://bagasvanbacdim:AcC7uZly6oV1Av7i@hris-project.thgt0lt.mongodb.net/attendance_db"
    ),
    nodeEnv: readEnv("NODE_ENV", "development"),

    security: {
      jwtSecret: readEnv("JWT_SECRET", ""),
      // TODO.md FR-006: attendance verification policies.
      attendance: {
        requireCamera: readEnv("ATTENDANCE_REQUIRE_CAMERA", "true") === "true",
        requireLocation: readEnv("ATTENDANCE_REQUIRE_LOCATION", "true") === "true",
        // 0 = disabled (permissive with warning); >0 blocks over this accuracy.
        maxAccuracyMeters: Number(readEnv("ATTENDANCE_MAX_ACCURACY_METERS", "0")),
      },
      jwtIssuer: readEnv("JWT_ISSUER", "hris-platform"),
      jwtAudience: readEnv("JWT_AUDIENCE", "hris-web"),
      accessTokenTtlSeconds: readNumber("ACCESS_TOKEN_TTL_SECONDS", 15 * 60),
      refreshTokenTtlSeconds: readNumber(
        "REFRESH_TOKEN_TTL_SECONDS",
        7 * 24 * 60 * 60
      ),
      bcryptRounds: readNumber("BCRYPT_ROUNDS", 12),
      maxFailedAttempts: readNumber("MAX_FAILED_ATTEMPTS", 5),
      lockoutMs: readNumber("LOCKOUT_MS", 15 * 60 * 1000),
      sessionInactivityMs: readNumber(
        "SESSION_INACTIVITY_MS",
        30 * 60 * 1000
      ),
      corsOrigins: readEnv("CORS_ORIGINS", "http://localhost:5173")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
      // Password policy defaults (FR-044). The stored platform setting (if
      // any) overrides these; defaults are applied until a Super Admin edits
      // the policy via the console.
      passwordPolicy: {
        minLength: readNumber("PASSWORD_MIN_LENGTH", 10),
        requireUppercase: readEnv("PASSWORD_REQUIRE_UPPERCASE", "true") === "true",
        requireLowercase: readEnv("PASSWORD_REQUIRE_LOWERCASE", "true") === "true",
        requireDigit: readEnv("PASSWORD_REQUIRE_DIGIT", "true") === "true",
        requireSpecial: readEnv("PASSWORD_REQUIRE_SPECIAL", "true") === "true",
        maxLength: readNumber("PASSWORD_MAX_LENGTH", 128),
        expiryDays: readNumber("PASSWORD_EXPIRY_DAYS", 90),
        historyLength: readNumber("PASSWORD_HISTORY_LENGTH", 5),
      },
      // Optional backend enforcement of the first-sign-in password gate.
      // Disabled by default so seed/bootstrap accounts (mustChangePassword)
      // and existing tests keep working; the frontend gate (§6.2) always runs.
      enforceFirstSignInGate: readEnv("ENFORCE_FIRST_SIGN_IN_GATE", "false") === "true",
      // Approval workflow defaults (FR-007/FR-042).
      approvals: {
        rejectionReasonRequired:
          readEnv("APPROVAL_REJECTION_REASON_REQUIRED", "true") === "true",
      },
    },

    rateLimit: {
      windowMs: readNumber("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
      maxRequests: readNumber("RATE_LIMIT_MAX", 100),
    },

    audit: {
      // Salt for the tamper-evidence hash chain. Must remain stable across
      // restarts or verification will report a broken chain.
      chainSalt: readEnv("AUDIT_CHAIN_SALT", "dev-audit-chain-salt"),
    },

    // FR-008: local disk directory for request attachments.
    attachmentAssetsDir: (() => {
      const configured = readEnv("ATTACHMENT_ASSETS_DIR", "");
      return configured
        ? configured
        : require("path").join(process.cwd(), "attachment-assets");
    })(),

    seed: {
      superAdminUsername: readEnv("SEED_SUPER_ADMIN_USERNAME", "superadmin"),
      superAdminEmail: readEnv("SEED_SUPER_ADMIN_EMAIL", "superadmin@corp.io"),
      superAdminPassword: readEnv("SEED_SUPER_ADMIN_PASSWORD", ""),
      // Demo roles/users/types/approval-configs are provisioned on boot.
      // Set SEED_DEMO_DATA=false to keep only the SUPER_ADMIN account + the
      // permission registry + role (clean-slate installs / production).
      demoData: readEnv("SEED_DEMO_DATA", "true") === "true",
    },
  };

  if (!config.security.jwtSecret) {
    if (config.nodeEnv === "production") {
      throw new Error("JWT_SECRET is required in production.");
    }
    // Development-only fallback so the scaffold runs out of the box.
    config.security.jwtSecret = "dev-only-insecure-secret-change-me";
  }

  if (!config.seed.superAdminPassword) {
    config.seed.superAdminPassword = "SuperAdmin2026!";
  }

  return config;
}

module.exports = { createConfig };
