/**
 * deploy.js — automated production deployment via FTP (AUTO_DEPLOY_PROD.md).
 *
 * Reads credentials from the local root `.env` file (never prints them):
 *   FTP_HOST, FTP_USER, FTP_PASSWORD, FTP_PORT,
 *   REMOTE_BACKEND_PATH (default /backend), REMOTE_FRONTEND_PATH (default /public_html)
 *
 * Flow:
 *   1. One-time purge of legacy directories/files inside REMOTE_FRONTEND_PATH
 *      (tolerant: missing items are skipped).
 *   2. Sync ./backend -> REMOTE_BACKEND_PATH (excludes node_modules, .git,
 *      .env, uploads, logs, local runtime upload dirs, and the two local
 *      provisioning seed scripts that embed deployment credentials).
 *   3. Sync ./frontend/dist -> REMOTE_FRONTEND_PATH (production build).
 *   4. Upload a React SPA .htaccess into REMOTE_FRONTEND_PATH.
 *   5. Signal Phusion Passenger to reload the Express app by (re)touching
 *      REMOTE_BACKEND_PATH/tmp/restart.txt.
 *
 * Usage: npm run deploy
 */

"use strict";

require("dotenv").config();

const path = require("path");
const os = require("os");
const fs = require("fs");
const FtpDeploy = require("ftp-deploy");
const ftp = require("basic-ftp");

const config = {
  host: process.env.FTP_HOST,
  user: process.env.FTP_USER,
  password: process.env.FTP_PASSWORD,
  port: Number(process.env.FTP_PORT) || 21,
  backendRoot: process.env.REMOTE_BACKEND_PATH || "/backend",
  frontRoot: process.env.REMOTE_FRONTEND_PATH || "/public_html",
};

if (!config.host || !config.user || !config.password) {
  console.error("[deploy] ABORT: FTP_HOST / FTP_USER / FTP_PASSWORD must be set in the root .env");
  process.exit(1);
}

// One-time remote legacy removal list (AUTO_DEPLOY_PROD.md §One-Time).
const PURGE_DIRS = [
  ".well-known", "amkp", "api", "api-server", "approval", "cgi-bin",
  "dashboard.simbika.com", "data", "data-pelamar", "demo", "forms",
  "info", "info-karir", "info.simbika.com", "inventory", "karir",
  "kelengkapan-data", "management", "portal", "sdm", "simsjarkot",
  "timeventure", "toko", "wordpress",
];

const PURGE_FILES = [
  "basic-landing-page.zip", "changelog.txt", "error_log",
  "googlefb6566fdb9f4b603.html", "hitcounter.php", "index.php",
  "indexx.php", "inner-page.html", "Readme.txt", "s.php",
  "underconstructions.html", "visitor.txt",
];

// Backend upload exclusions (spec) + local runtime uploads (the server keeps
// its own) + the local MongoDB data directory (never upload DB binaries) +
// root-level scratch *.txt test-output files (dev artifacts) + local
// provisioning scripts that embed deployment credentials.
const BACKEND_EXCLUDES = [
  "node_modules/**", "node_modules/**/*",
  ".git/**", ".git/**/*",
  // Local MongoDB data — never upload database binaries to production.
  ".mongo-data/**", ".mongo-data/**/*",
  ".env", ".env.*",
  "uploads/**", "uploads/**/*",
  "logs/**", "logs/**/*",
  "*.log",
  // Root-level scratch test-output files (e.g. full-r*.txt, bit*.txt).
  "*.txt",
  "attendance-media/**", "attendance-media/**/*",
  "branding-assets/**", "branding-assets/**/*",
  "attachment-assets/**", "attachment-assets/**/*",
  "salary-assets/**", "salary-assets/**/*",
  "scripts/seed-initial-production.js",
  "scripts/reset-and-seed-tad-simbika.js",
];

const HTACCESS_CONTENT = `# React SPA — client-side routing (AUTO_DEPLOY_PROD.md)
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteBase /
    RewriteRule ^index\\.html$ - [L]
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule . /index.html [L]
</IfModule>

<IfModule mod_headers.c>
    Header set X-Content-Type-Options "nosniff"
</IfModule>
`;

function log(...args) {
  console.log("[deploy]", ...args);
}

function logError(...args) {
  console.error("[deploy]", ...args);
}

function tempFile(name, content) {
  const file = path.join(os.tmpdir(), name);
  fs.writeFileSync(file, content);
  return file;
}

/** Purges the legacy removal list under a remote root (tolerant). */
async function purgeLegacy(client, remoteRoot) {
  for (const dir of PURGE_DIRS) {
    try {
      await client.removeDir(path.posix.join(remoteRoot, dir));
      log(`purged dir  ${dir}`);
    } catch (err) {
      log(`skip dir   ${dir} (${err.message})`);
    }
  }
  for (const file of PURGE_FILES) {
    try {
      await client.remove(path.posix.join(remoteRoot, file));
      log(`purged file ${file}`);
    } catch (err) {
      log(`skip file  ${file} (${err.message})`);
    }
  }
}

/** Syncs a local directory tree to a remote path via ftp-deploy (with retry). */
async function syncDir(localRoot, remoteRoot, exclude, label, attempts = 12) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const deployer = new FtpDeploy();
    try {
      await deployer.deploy({
        user: config.user,
        password: config.password,
        host: config.host,
        port: config.port,
        localRoot,
        remoteRoot,
        include: ["*", "**/*"],
        exclude,
        deleteRemote: false,
        forcePasv: true,
      });
      log(`${label} synced -> ${remoteRoot}`);
      return;
    } catch (err) {
      lastErr = err;
      log(`${label} attempt ${attempt}/${attempts} failed (${err.message}); retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  throw lastErr;
}

/** Basic-FTP helper: connect + purge + uploads, then close. */
async function withFtpClient(fn) {
  const client = new ftp.Client(60_000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: config.host,
      user: config.user,
      password: config.password,
      port: config.port,
      secure: false,
    });
    await fn(client);
  } finally {
    client.close();
  }
}

(async () => {
  log(`host=${config.host} backend=${config.backendRoot} front=${config.frontRoot}`);

  // 1) One-time legacy purge.
  log("purging legacy files...");
  await withFtpClient((client) => purgeLegacy(client, config.frontRoot));

  // 2) Backend sync.
  log("syncing backend...");
  await syncDir(
    path.join(__dirname, "backend"),
    config.backendRoot,
    BACKEND_EXCLUDES,
    "backend"
  );

  // 3) Frontend production build sync.
  const dist = path.join(__dirname, "frontend", "dist");
  if (!fs.existsSync(dist)) {
    logError("ABORT: ./frontend/dist missing — run `npm run build` in ./frontend first.");
    process.exit(1);
  }
  log("syncing frontend build...");
  await syncDir(dist, config.frontRoot, [".git/**"], "frontend");

  // 4) .htaccess for SPA routing.
  log("uploading .htaccess...");
  const htaccessLocal = tempFile("deploy-htaccess", HTACCESS_CONTENT);
  await withFtpClient((client) =>
    client.uploadFrom(htaccessLocal, path.posix.join(config.frontRoot, ".htaccess"))
  );
  log(".htaccess uploaded");

  // 5) Passenger restart signal.
  log("signalling Passenger restart...");
  const restartLocal = tempFile(
    "deploy-restart.txt",
    `# touched ${new Date().toISOString()} — Phusion Passenger reload\n`
  );
  await withFtpClient(async (client) => {
    await client.ensureDir(path.posix.join(config.backendRoot, "tmp"));
    await client.uploadFrom(restartLocal, path.posix.join(config.backendRoot, "tmp", "restart.txt"));
  });
  log("restart.txt touched");

  log("done.");
})().catch((err) => {
  logError("failed:", err.message);
  process.exit(1);
});