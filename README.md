# Checklist Ledger

Checklist Ledger is a single-user hosted checklist app designed for two users:

- a human who wants a fast web checklist
- Codex, which should mutate the checklist through a stable CLI instead of
  manually editing database rows

The app deploys as one Cloudflare Worker. The Worker serves the Vite React UI
from static assets and exposes token-protected API routes backed by D1.

Current deployment:

```text
https://hosted-checklist.mutdashboard.workers.dev
```

Current D1 database:

```text
checklist-ledger / 4094cd40-9c59-4434-915e-dd95cd63ab54
```

## Local Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Create local Worker secrets:

   ```powershell
   Copy-Item .dev.vars.example .dev.vars
   ```

3. Apply local D1 migrations:

   ```powershell
   npm run db:migrate:local
   ```

4. Build and run the Worker:

   ```powershell
   npm run build
   npm run dev
   ```

5. Open the app:

   ```text
   http://127.0.0.1:8787
   ```

Use the token from `.dev.vars` in the browser login screen.

## CLI Usage

The CLI talks to the same API as the browser UI. This is the safe control layer
for Codex because every mutation still passes through validation in the Worker.

Set the remote or local API target:

```powershell
$env:CHECKLIST_API_URL = "http://127.0.0.1:8787"
$env:CHECKLIST_ADMIN_TOKEN = "local-dev-token"
```

Run commands:

```powershell
npm run cli -- list
npm run cli -- add "Write deployment notes" --details "Add D1 setup and custom domain steps."
npm run cli -- child 1 "Create the production D1 database"
npm run cli -- move 2 --before 1
npm run cli -- done 1
npm run cli -- finished
npm run cli -- reopen 1
```

After `npm run build`, the compiled binary entrypoint is available at:

```text
dist\cli\index.js
```

For a persistent production CLI config, copy this example to your home folder
and edit the values:

```powershell
Copy-Item checklist-ledger.config.example.json $HOME\.checklist-ledger.json
notepad $HOME\.checklist-ledger.json
```

This machine is currently configured for production CLI access at:

```text
C:\Users\jfrie\.checklist-ledger.json
```

The generated production admin token is stored locally at:

```text
C:\Users\jfrie\Documents\Codex\2026-04-23\can-you-access-my-google-tasks\.checklist-production-token.txt
```

## Cloudflare Deployment Notes

1. Create the production D1 database:

   ```powershell
   npx wrangler d1 create checklist-ledger
   ```

   If this fails with `Authentication error [code: 10000]`, the active
   `CLOUDFLARE_API_TOKEN` can identify the account but does not have the D1 API
   permissions needed for database list/create/migration operations.

2. Put the returned `database_id` into `wrangler.jsonc`.

3. Set the production admin token:

   ```powershell
   npx wrangler secret put ADMIN_TOKEN
   ```

4. Apply remote migrations:

   ```powershell
   npm run db:migrate:remote
   ```

5. Deploy:

   ```powershell
   npm run deploy
   ```

6. Point your custom domain at the Worker in Cloudflare.

7. Configure CLI access with the same token value you entered for the Worker
   `ADMIN_TOKEN` secret.

## Verification Commands

Run these before deploying:

```powershell
npm run check
npm test
npm run deploy:dry-run
```

The dry run validates that Wrangler can bundle the Worker, read static assets,
and see the D1 and asset bindings without publishing a new Worker version.

For CLI use against production, set:

```powershell
$env:CHECKLIST_API_URL = "https://your-custom-domain.example"
$env:CHECKLIST_ADMIN_TOKEN = "your-production-token"
```

## Data Model

`items` is the source of truth for checklist rows:

- `status = active` rows appear in the active checklist
- `status = finished` rows appear in the Finished view
- `parent_id = null` means top-level item
- `parent_id = <id>` means one-level child item

The Worker rejects grandchildren in v1 so the UI, CLI, and data model stay easy
to reason about.
