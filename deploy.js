/**
 * deploy.js — verified production deployment via FTP.
 *
 * The cPanel Passenger supervisor is not reliable for this application. The
 * deployment therefore uploads a restart request for the server-side cron
 * watchdog in backend/ops/restart.sh and waits for an acknowledgement before
 * reporting success.
 *
 * Usage:
 *   npm run deploy
 *   npm run deploy -- --purge-legacy
 *   npm run deploy -- --skip-build
 */

"use strict";

require("dotenv").config();

const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const https = require("https");
const { execFileSync } = require("child_process");
const FtpDeploy = require("ftp-deploy");
const ftp = require("basic-ftp");

const ROOT = __dirname;
const FRONTEND_ROOT = path.join(ROOT, "frontend");
const FRONTEND_DIST = path.join(FRONTEND_ROOT, "dist");
const FRONTEND_HTACCESS = path.join(FRONTEND_ROOT, "public", ".htaccess");
const RESTART_SCRIPT = path.join(ROOT, "backend", "ops", "restart.sh");
const args = new Set(process.argv.slice(2));

const config = {
  host: process.env.FTP_HOST,
  user: process.env.FTP_USER,
  password: process.env.FTP_PASSWORD,
  port: Number(process.env.FTP_PORT) || 21,
  backendRoot: process.env.REMOTE_BACKEND_PATH || "/backend_app",
  frontRoot: process.env.REMOTE_FRONTEND_PATH || "/public_html",
  expectedBackendRoot:
    process.env.EXPECTED_REMOTE_BACKEND_PATH || "/backend_app",
  expectedFrontendRoot:
    process.env.EXPECTED_REMOTE_FRONTEND_PATH || "/public_html",
  expectedApiHost: process.env.EXPECTED_API_HOST || "api.simbika.com",
  healthUrl:
    process.env.DEPLOY_HEALTH_URL || "https://api.simbika.com/health",
  restartTimeoutMs: Number(process.env.DEPLOY_RESTART_TIMEOUT_MS) || 180_000,
  pollIntervalMs: Number(process.env.DEPLOY_POLL_INTERVAL_MS) || 5_000,
};

if (!config.host || !config.user || !config.password) {
  throw new Error(
    "FTP_HOST / FTP_USER / FTP_PASSWORD must be set in the root .env"
  );
}

if (config.backendRoot !== config.expectedBackendRoot) {
  throw new Error(
    `REMOTE_BACKEND_PATH must be ${config.expectedBackendRoot}; received ${config.backendRoot}`
  );
}

if (config.frontRoot !== config.expectedFrontendRoot) {
  throw new Error(
    `REMOTE_FRONTEND_PATH must be ${config.expectedFrontendRoot}; received ${config.frontRoot}`
  );
}

// Explicitly opt-in legacy cleanup. Normal deployments must not delete
// unrelated public_html content.
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

// Never upload secrets, dependencies, databases, runtime uploads, local logs,
// deployment acknowledgements, or local test artifacts.
const BACKEND_EXCLUDES = [
  "node_modules/**", "node_modules/**/*",
  "node_modules/**/.*", "node_modules/**/.*/**", "node_modules/**/.*/**/*",
  ".git/**", ".git/**/*",
  // cPanel-managed backend routing/environment configuration.
  ".htaccess",
  ".mongo-data/**", ".mongo-data/**/*",
  ".env", ".env.*",
  "uploads/**", "uploads/**/*",
  "logs/**", "logs/**/*",
  "*.log",
  "*.txt",
  "tmp/**", "tmp/**/*",
  "app.pid", "app.log",
  "attendance-media/**", "attendance-media/**/*",
  "branding-assets/**", "branding-assets/**/*",
  "attachment-assets/**", "attachment-assets/**/*",
  "salary-assets/**", "salary-assets/**/*",
  "scripts/seed-initial-production.js",
  "scripts/reset-and-seed-tad-simbika.js",
];

function log(...messages) {
  console.log("[deploy]", ...messages);
}

function logError(...messages) {
  console.error("[deploy]", ...messages);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function temporaryFile(prefix, content = "") {
  const file = path.join(
    os.tmpdir(),
    `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  fs.writeFileSync(file, content, "utf8");
  return file;
}

function removeFileQuietly(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    // The temporary file may already have been removed.
  }
}

function runFrontendBuild() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  log("building frontend...");
  execFileSync(npmCommand, ["run", "build"], {
    cwd: FRONTEND_ROOT,
    stdio: "inherit",
  });
  log("frontend build completed");
}

function collectFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function verifyFrontendBuild() {
  const indexFile = path.join(FRONTEND_DIST, "index.html");
  const assetsDirectory = path.join(FRONTEND_DIST, "assets");

  if (!fs.existsSync(indexFile)) {
    throw new Error(`frontend build is missing ${indexFile}`);
  }

  const javascriptFiles = collectFiles(assetsDirectory).filter((file) =>
    file.toLowerCase().endsWith(".js")
  );

  if (javascriptFiles.length === 0) {
    throw new Error("frontend build contains no JavaScript assets");
  }

  const bundleContents = javascriptFiles.map((file) => fs.readFileSync(file, "utf8"));
  const forbiddenLocalHosts = ["http://localhost:5000", "http://127.0.0.1:5000"];
  const localHostAsset = bundleContents.find((content) =>
    forbiddenLocalHosts.some((host) => content.includes(host))
  );

  if (localHostAsset) {
    throw new Error(
      "frontend production bundle contains a localhost API URL; check frontend/.env.production"
    );
  }

  const expectedHost = config.expectedApiHost.replace(/^https?:\/\//, "");
  if (!bundleContents.some((content) => content.includes(expectedHost))) {
    throw new Error(
      `frontend production bundle does not contain the expected API host ${expectedHost}`
    );
  }

  log(`frontend build verified (${javascriptFiles.length} JavaScript asset(s))`);
}

function gitOutput(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function createDeployId() {
  const revision = gitOutput(["rev-parse", "--short", "HEAD"]) || "manual";
  const dirty = gitOutput(["status", "--porcelain"]) ? "-dirty" : "";
  return `${revision}${dirty}-${new Date().toISOString().replace(/[^0-9TZ]/g, "")}`;
}

/** Purge the legacy removal list under a remote root (tolerant). */
async function purgeLegacy(client, remoteRoot) {
  for (const directory of PURGE_DIRS) {
    try {
      await client.removeDir(path.posix.join(remoteRoot, directory));
      log(`purged dir  ${directory}`);
    } catch (error) {
      log(`skip dir   ${directory} (${error.message})`);
    }
  }

  for (const file of PURGE_FILES) {
    try {
      await client.remove(path.posix.join(remoteRoot, file));
      log(`purged file ${file}`);
    } catch (error) {
      log(`skip file  ${file} (${error.message})`);
    }
  }
}

/** Sync a local directory tree to a remote path via ftp-deploy. */
async function syncDir(localRoot, remoteRoot, exclude, label, attempts = 12) {
  let lastError;

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
    } catch (error) {
      lastError = error;
      log(
        `${label} attempt ${attempt}/${attempts} failed (${error.message}); retrying...`
      );
      await sleep(5_000);
    }
  }

  throw lastError;
}

/** Basic-FTP helper: connect, run a callback, then close. */
async function withFtpClient(callback) {
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
    return await callback(client);
  } finally {
    client.close();
  }
}

async function uploadText(remotePath, content) {
  const localFile = temporaryFile("deploy-upload", content);
  try {
    await withFtpClient(async (client) => {
      await client.ensureDir(path.posix.dirname(remotePath));
      await client.uploadFrom(localFile, remotePath);
    });
  } finally {
    removeFileQuietly(localFile);
  }
}

async function uploadFile(remotePath, localPath, { normalizeLineEndings = false } = {}) {
  if (!fs.existsSync(localPath)) {
    throw new Error(`required deployment file is missing: ${localPath}`);
  }

  let sourcePath = localPath;
  let temporarySource;

  if (normalizeLineEndings) {
    const content = fs.readFileSync(localPath, "utf8").replace(/\r\n?/g, "\n");
    temporarySource = temporaryFile("deploy-normalized", content);
    sourcePath = temporarySource;
  }

  try {
    await withFtpClient(async (client) => {
      await client.ensureDir(path.posix.dirname(remotePath));
      await client.uploadFrom(sourcePath, remotePath);
    });
  } finally {
    if (temporarySource) removeFileQuietly(temporarySource);
  }
}

async function readRemoteText(remotePath) {
  const localFile = temporaryFile("deploy-download");
  try {
    await withFtpClient((client) => client.downloadTo(localFile, remotePath));
    return fs.readFileSync(localFile, "utf8").trim();
  } catch {
    return null;
  } finally {
    removeFileQuietly(localFile);
  }
}

async function waitForRestartAcknowledgement(deployId) {
  const remoteDonePath = path.posix.join(
    config.backendRoot,
    "tmp",
    "restart.done"
  );
  const deadline = Date.now() + config.restartTimeoutMs;
  let nextProgressLog = Date.now();

  while (Date.now() < deadline) {
    const acknowledgedId = await readRemoteText(remoteDonePath);
    if (acknowledgedId === deployId) {
      log(`backend restart acknowledged: ${deployId}`);
      return;
    }

    if (Date.now() >= nextProgressLog) {
      log("waiting for cPanel cron watchdog to restart the backend...");
      nextProgressLog = Date.now() + 15_000;
    }

    await sleep(config.pollIntervalMs);
  }

  throw new Error(
    `backend restart was not acknowledged within ${config.restartTimeoutMs / 1000}s; check ${config.backendRoot}/ops/restart.log and app.log`
  );
}

function requestStatus(url) {
  const client = url.startsWith("https:") ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.get(url, (response) => {
      response.resume();
      resolve(response.statusCode || 0);
    });

    request.setTimeout(15_000, () => {
      request.destroy(new Error(`request timed out: ${url}`));
    });
    request.on("error", reject);
  });
}

async function verifyProductionHealth() {
  const status = await requestStatus(config.healthUrl);
  if (status !== 200) {
    throw new Error(`production health check returned HTTP ${status}`);
  }
  log(`production health verified: ${config.healthUrl} -> HTTP ${status}`);
}

/**
 * Removes a stale/conflicting remote node_modules entry. A file or empty
 * directory named node_modules can block future server-side npm installation.
 * A populated node_modules directory is never touched.
 */
async function cleanupBackendNodeModules() {
  const target = path.posix.join(config.backendRoot, "node_modules");

  await withFtpClient(async (client) => {
    let parentEntries;
    try {
      parentEntries = await client.list(config.backendRoot);
    } catch (error) {
      log(`cannot list backend root (${error.message})`);
      return;
    }

    const nodeModulesEntry = parentEntries.find((entry) => entry.name === "node_modules");
    if (!nodeModulesEntry) {
      log("no remote node_modules to clean");
      return;
    }

    if (nodeModulesEntry.isDirectory) {
      const inner = await client.list(target);
      if (inner.length > 0) {
        log("remote node_modules has content — leaving it untouched");
        return;
      }
      await client.removeDir(target);
      log("removed conflicting empty node_modules directory");
      return;
    }

    await client.remove(target);
    log("removed conflicting node_modules file entry");
  });
}

(async () => {
  const purgeLegacy = args.has("--purge-legacy");
  const skipBuild = args.has("--skip-build");
  const deployId = createDeployId();

  log(`host=${config.host} backend=${config.backendRoot} front=${config.frontRoot}`);
  log(`deployment id=${deployId}`);

  if (!skipBuild) {
    runFrontendBuild();
  } else {
    log("skipping frontend build because --skip-build was supplied");
  }
  verifyFrontendBuild();

  if (!fs.existsSync(FRONTEND_HTACCESS)) {
    throw new Error(`required frontend .htaccess is missing: ${FRONTEND_HTACCESS}`);
  }
  if (!fs.existsSync(RESTART_SCRIPT)) {
    throw new Error(`required restart watchdog is missing: ${RESTART_SCRIPT}`);
  }

  if (purgeLegacy) {
    log("purging explicitly requested legacy files...");
    await withFtpClient((client) => purgeLegacy(client, config.frontRoot));
  } else {
    log("skipping legacy purge; use --purge-legacy to enable it");
  }

  await cleanupBackendNodeModules();

  log("syncing backend...");
  await syncDir(
    path.join(ROOT, "backend"),
    config.backendRoot,
    BACKEND_EXCLUDES,
    "backend"
  );

  log("syncing frontend build...");
  await syncDir(FRONTEND_DIST, config.frontRoot, [".git/**"], "frontend");

  log("uploading authoritative frontend .htaccess...");
  await uploadFile(
    path.posix.join(config.frontRoot, ".htaccess"),
    FRONTEND_HTACCESS
  );

  log("uploading normalized backend restart watchdog...");
  await uploadFile(
    path.posix.join(config.backendRoot, "ops", "restart.sh"),
    RESTART_SCRIPT,
    { normalizeLineEndings: true }
  );

  log("requesting controlled backend restart...");
  await uploadText(
    path.posix.join(config.backendRoot, "tmp", "restart.request"),
    `${deployId}\n`
  );

  await waitForRestartAcknowledgement(deployId);
  await verifyProductionHealth();

  log("deployment completed and backend verification passed");
})().catch((error) => {
  logError("failed:", error.message);
  process.exitCode = 1;
});
