# Auto-Deployment via FTP (React + Express) — cPanel

## Objective

Run one command from the repository root:

```text
npm run deploy
```

The deployment must:

1. Build the frontend from the current source.
2. Upload the backend and frontend to the correct cPanel directories.
3. Request one controlled backend restart.
4. Prevent duplicate `node server.js` processes.
5. Verify that the new backend is healthy before reporting success.

The cPanel Passenger supervisor is currently unreliable. Therefore, this
deployment uses a server-side cron watchdog and does not rely on
`tmp/restart.txt`.

## Production Paths

These paths were verified against the running production process:

| Item | Value |
|---|---|
| Backend application root | `/home/simbika1/backend_app` |
| Remote backend path | `/backend_app` |
| Node binary | `/home/simbika1/nodevenv/backend_app/20/bin/node` |
| Backend port | `5000` |
| Backend environment | `production` |
| Frontend document root | `/public_html` |
| Public API origin | `https://api.simbika.com` |
| Frontend API base | `https://api.simbika.com/api/v1` |

Do not change the backend path to `/backend` unless the complete cPanel
application configuration is intentionally migrated and verified.

## Local Configuration

Read credentials from the root `.env` file. Never print their values:

- `FTP_HOST`
- `FTP_USER`
- `FTP_PASSWORD`
- `FTP_PORT`
- `REMOTE_BACKEND_PATH` — must be `/backend_app`
- `REMOTE_FRONTEND_PATH` — must be `/public_html`
- `EXPECTED_API_HOST` — recommended value: `api.simbika.com`

The backend `.env` is production-only and is never uploaded.

## One-Time cPanel Setup

After `backend/ops/restart.sh` has been uploaded, add this cPanel Cron Job:

```text
* * * * * /bin/bash /home/simbika1/backend_app/ops/restart.sh >> /home/simbika1/backend_app/ops/restart.log 2>&1
```

The cron job runs once per minute and performs two jobs:

1. Restarts the backend when a new deployment request is uploaded.
2. Starts the backend if it is missing after a crash or server restart.

Do not run `node server.js` manually after this cron job is active.

## Deployment Handshake

The deployment uses these server files:

- `tmp/restart.request` — written by `deploy.js` with a unique deployment ID.
- `tmp/restart.done` — written by `restart.sh` after the new process passes
  the local health check.
- `app.pid` — PID of the one expected backend process.
- `app.log` — append-only backend startup/runtime log.
- `ops/restart.log` — watchdog log.

`deploy.js` waits for `tmp/restart.done` to contain the current deployment ID.
It must not report success if the restart has not been confirmed.

## Required `deploy.js` Behavior

`deploy.js` must:

1. Build the frontend automatically with `npm run build` in `frontend/`.
2. Abort if the frontend build fails.
3. Verify that `frontend/dist/index.html` exists.
4. Verify that at least one JavaScript file exists under `frontend/dist/assets/`.
5. Fail if the production bundle contains `localhost:5000` or
   `127.0.0.1:5000`.
6. Verify that `EXPECTED_API_HOST` appears in the production bundle.
7. Verify that `REMOTE_BACKEND_PATH` is `/backend_app` and
   `REMOTE_FRONTEND_PATH` is `/public_html`.
8. Sync `backend/` to `/backend_app`.
9. Sync `frontend/dist/` to `/public_html`.
10. Upload the committed `frontend/public/.htaccess` explicitly.
11. Upload the server watchdog `backend/ops/restart.sh` with LF line endings.
12. Upload `backend/tmp/restart.request` with a unique deployment ID.
13. Wait up to three minutes for `tmp/restart.done` to contain that ID.
14. Verify `https://api.simbika.com/health` returns HTTP 200.
15. Print the deployment ID and verification result.
16. Exit with a failure code if any required step fails.

Normal deployment command:

```text
npm run deploy
```

The legacy cleanup is not part of normal deployment. Run it only explicitly:

```text
npm run deploy -- --purge-legacy
```

## Server Watchdog Behavior

`backend/ops/restart.sh` must:

1. Use an atomic lock so two cron executions cannot restart simultaneously.
2. Operate only on processes whose working directory is exactly
   `/home/simbika1/backend_app` and whose command contains `server.js`.
3. Never kill Node processes belonging to another application.
4. Detect a new `tmp/restart.request` deployment ID.
5. Detect when the backend process is missing.
6. If `package-lock.json` changed, run the production dependency install before
   stopping the existing healthy process.
7. Gracefully stop all old matching processes.
8. Wait for them to exit and for port 5000 to become free.
9. Force-kill only matching leftovers after the graceful timeout.
10. Start exactly one process with:

```text
NODE_ENV=production PORT=5000 nohup /home/simbika1/nodevenv/backend_app/20/bin/node server.js >> app.log 2>&1 &
```

11. Save the new PID to `app.pid`.
12. Wait for `http://127.0.0.1:5000/health` to return HTTP 200.
13. Write the request ID to `tmp/restart.done` only after the health check passes.
14. Leave the old process running if dependency installation fails.
15. Retry safely on the next cron cycle if startup fails.

Manual emergency fallback:

```text
bash /home/simbika1/backend_app/ops/restart.sh --force
```

## Backend Upload Exclusions

Never upload production secrets, dependencies, databases, runtime uploads, or
local test artifacts:

- `node_modules/**`
- `.git/**`
- `.env` and `.env.*`
- Backend `.htaccess` managed by cPanel
- `uploads/**`
- `logs/**`
- `*.log`
- Root scratch `*.txt` files
- `.mongo-data/**`
- `attendance-media/**`
- `branding-assets/**`
- `attachment-assets/**`
- `salary-assets/**`
- `scripts/seed-initial-production.js`
- `scripts/reset-and-seed-tad-simbika.js`

The server's existing production `.env`, uploaded files, and local runtime
directories must remain untouched by FTP synchronization.

## Frontend Routing and Caching

`frontend/public/.htaccess` is the authoritative frontend routing file and is
uploaded explicitly on every deployment.

It must:

- Serve the React SPA fallback for normal browser routes.
- Prevent caching of `index.html` so new asset filenames are discovered.
- Allow long-lived caching for hashed files under `/assets/`.
- Not contain the stale Passenger block pointing to
  `/home/simbika1/backend`.
- Not route `/api` through the broken Passenger configuration. The current
  production frontend calls `https://api.simbika.com/api/v1` directly.

If Passenger is intentionally repaired in the future, migrate fully to
Passenger and stop the manual/cron process. Do not run both systems.

## One-Time Legacy Cleanup

The following legacy directories and files may be removed from
`REMOTE_FRONTEND_PATH` only when `--purge-legacy` is explicitly supplied.

### Directories

`.well-known`, `amkp`, `api`, `api-server`, `approval`, `cgi-bin`,
`dashboard.simbika.com`, `data`, `data-pelamar`, `demo`, `forms`, `info`,
`info-karir`, `info.simbika.com`, `inventory`, `karir`, `kelengkapan-data`,
`management`, `portal`, `sdm`, `simsjarkot`, `timeventure`, `toko`, `wordpress`

### Files

`basic-landing-page.zip`, `changelog.txt`, `error_log`,
`googlefb6566fdb9f4b603.html`, `hitcounter.php`, `index.php`, `indexx.php`,
`inner-page.html`, `Readme.txt`, `s.php`, `underconstructions.html`,
`visitor.txt`

Never purge these items during an ordinary deployment.

## Verification Checklist

After a successful deployment:

- `tmp/restart.done` contains the current deployment ID.
- Exactly one matching backend process exists.
- `https://api.simbika.com/health` returns HTTP 200.
- `app.log` contains the production listening message.
- `app.log` contains no `EADDRINUSE` or `Cannot find module` error.
- The frontend loads after a hard refresh.
- Changed backend and frontend behavior is manually tested.

## Failure Rules

- Build failure: stop before uploading anything.
- FTP failure: stop and do not report success.
- Restart timeout: report the deployment as incomplete and show
  `ops/restart.log` and `app.log` locations.
- Health failure: do not report success.
- Dependency installation failure: keep the existing healthy process running.
- Never hide a failed restart behind a successful FTP upload message.

## Security Rules

- Never upload `.env` files.
- Never print FTP, MongoDB, JWT, or seed credentials.
- Never kill processes outside `/home/simbika1/backend_app`.
- Never expose private backend upload directories through public static routes.
- Prefer FTPS/SFTP when the hosting provider supports it.
