# Checklist Ledger CLI

The CLI is the supported control layer for humans and Codex. It talks to the
same authenticated API as the browser UI, so commands use the production D1
database through the Worker instead of editing data directly.

## Install

After the package is published:

```powershell
npm install -g checklist-ledger
checklist help
```

Before the first npm publish, install from a local checkout:

```powershell
npm install -g C:\Users\jfrie\Documents\Codex\2026-04-23\can-you-access-my-google-tasks
checklist help
```

For local development from this repo:

```powershell
npm install
npm run build:cli
npm install -g .
checklist help
```

## Configure

Create `C:\Users\<you>\.checklist-ledger.json`:

```json
{
  "apiUrl": "https://todo.joshfriedman-dev.com",
  "adminToken": "PASTE_ADMIN_TOKEN_HERE",
  "defaultLedgerId": 1
}
```

Environment variables override the file:

```powershell
$env:CHECKLIST_API_URL = "https://todo.joshfriedman-dev.com"
$env:CHECKLIST_ADMIN_TOKEN = "PASTE_ADMIN_TOKEN_HERE"
$env:CHECKLIST_LEDGER_ID = "1"
```

## Ledger Commands

List ledgers:

```powershell
checklist ledgers
```

Create a ledger:

```powershell
checklist ledger add "Home"
```

Use a ledger by ID or name:

```powershell
checklist list --ledger 1
checklist list --ledger Today
checklist add "Pay electric bill" --ledger Home
```

Use `checklist ledgers` whenever you need to discover valid ledger IDs or names.

## Item Discovery

List active items in the default ledger:

```powershell
checklist list
```

List the whole active ledger with details and subitems:

```powershell
checklist list full --ledger Today
checklist list full --ledger slarmen
```

List a 1-based range of top-level active items:

```powershell
checklist list 1-4 --ledger Today
```

List a 1-based range with full details and subitems:

```powershell
checklist list full 1-4 --ledger Today
```

List finished items:

```powershell
checklist finished
```

Search active and finished items by title:

```powershell
checklist find "electric"
checklist find "deploy" --ledger Today
```

Use the printed `#id` values for exact follow-up commands. Most item commands
also accept a unique title fragment, so these are equivalent when only one item
matches:

```powershell
checklist details 12
checklist details --item 12
checklist details "electric"
checklist details --item "electric"
```

In PowerShell, `#5` starts a comment unless quoted. Prefer `5`, or quote the
hash form:

```powershell
checklist details --item 5
checklist details --item "#5"
```

If a title fragment matches multiple items, the CLI prints the candidate IDs so
Codex or a human can retry with an exact `#id`.

## Item Commands

Add an item:

```powershell
checklist add "Write deployment notes"
checklist add "Write deployment notes" --details "Include D1 migration steps."
checklist add "Write deployment notes" --ledger Today
```

Add a child item:

```powershell
checklist child 12 "Add screenshots"
checklist child "deployment notes" "Add screenshots"
```

Read details:

```powershell
checklist details 12
checklist details "deployment notes"
```

Update title or details:

```powershell
checklist update 12 --title "Write CLI docs"
checklist update --item 12 --title "Write CLI docs"
checklist update "deployment notes" --details "Document npm install and token setup."
```

Finish and reopen:

```powershell
checklist done 12
checklist done --item 12
checklist done "deployment notes"
checklist reopen 12
```

Reorder top-level active items:

```powershell
checklist move 14 --before 12
checklist move --item 14 --before 12
checklist move "write docs" --after "deploy app"
```

## Output Conventions

Item output includes:

```text
#12 [active] ledger:1 Write CLI docs
```

Ledger output includes:

```text
#1 Today
```

Codex should prefer exact IDs after discovery, especially for destructive or
state-changing commands such as `done`, `reopen`, `update`, and `move`.
