---
name: checklist-ledger
description: Collaborate on a hosted checklist/to-do list with your user through the `checklist` CLI. Use when the user mentions their "checklist", "to-do list", "ledger", items to add/finish/move, or asks for help tracking tasks. The CLI is the only supported way to mutate the data — do not edit D1 or call the Worker API directly.
---

# checklist-ledger

The user has a single-user hosted checklist app (Cloudflare Worker + D1 + Vite
React UI). It is designed to be driven by agents. You and the user share the
same list — when you add, finish, or move items, the user sees them in the
browser, and vice versa.

The supported way to mutate the list is the `checklist` CLI (this repo). The
CLI talks to the Worker's token-protected API; both the browser UI and the CLI
go through the same auth, so you and the user are operating on one source of
truth.

## When to use this skill

- The user mentions "my checklist", "to-do list", "ledger", or any task they
  want tracked across sessions.
- The user asks "what's on my list?" or "what did we finish?".
- The user says "add X to the list", "mark Y done", "move Z up", "remind me
  to ...".
- You are starting a multi-step task and want to leave breadcrumbs the user
  can see, or you want to check whether the user already has an item for what
  you are about to do.
- You are doing work on the user's behalf that maps to discrete deliverables
  — file an item, do the work, mark it done.

When NOT to use this skill:

- The user is asking about a one-off task that doesn't need to persist across
  sessions. Use your normal scratchpad.
- The user is asking how to use the CLI themselves. Point them at
  `docs/CLI.md`.
- You need to inspect raw database rows. That's outside the supported contract;
  use the CLI.

## First-run check

Before any `checklist` command, verify the CLI is reachable and authenticated:

```
checklist ledgers
```

If you see a ledger list, you're good. If you see an error:

- **`Missing or invalid checklist admin token.` (401)** — the token in
  `~/.checklist-ledger.json` does not match the Worker's `ADMIN_TOKEN`
  secret. Stop and tell the user; do NOT guess or retry with old values. The
  fix is `wrangler secret put ADMIN_TOKEN` on a machine with wrangler
  authenticated, then `checklist login --api-key <new-token>` on every
  client.
- **`Set CHECKLIST_API_URL and CHECKLIST_ADMIN_TOKEN, or create
  ~/.checklist-ledger.json.`** — no config at all. Run
  `checklist login --api-key <token>` (added in this repo; persists to
  `~/.checklist-ledger.json`).
- **`command not found: checklist`** — the package isn't installed. Tell
  the user; installing is a human-side step (`npm install -g checklist-ledger`
  after publish, or `npm install -g .` from a local checkout).

## The mental model

A ledger is a named list. The default ledger has id `1`. Each ledger holds
items; each item can have child items (subtasks). Items are either `active`
or `finished`. There is no concept of priority, tags, due dates, or
assignees in v1 — just title, optional details, status, position, and a
parent-child hierarchy.

There is no "create ledger" workflow in this skill. If you need a new
ledger, ask the user; `checklist ledger add "<name>"` exists but most users
will want one ledger they share with you.

## The four operations agents actually use

You will spend 95% of your checklist work in these commands. The full
reference is `checklist help`.

### 1. See what's there

```
checklist list                          # active items in default ledger
checklist list --ledger "Work"          # active items in a named ledger
checklist list full                     # include details and timestamps
checklist list 1-10                     # a positional range by display order
checklist finished                      # recently finished items
checklist find "auth bug"               # substring search over titles
checklist ledgers                       # list all ledgers (incl. --all)
```

`checklist list` is the first thing to run when a session starts and the user
has mentioned prior work — it tells you what's already in flight and what
they've been thinking about. Run it before adding new items so you don't
duplicate.

### 2. Add items

```
checklist add "Write deployment notes" \
  --details "Add D1 setup and custom domain steps." \
  --ledger "Today"
checklist child 3 "Create the production D1 database"
```

`checklist add` always creates a top-level item at the bottom of the
ledger. `checklist child <parent> "<title>"` adds a sub-item under an
existing item, matched by id or title substring. Use `--details` for anything
longer than a sentence; the user's UI shows details in an expandable panel.

Decision rule for "is this a child or a new top-level item?":

- If it is a sub-step of an item already on the list → child.
- If it is its own deliverable the user will look at independently → top-level.
- When in doubt, ask. Duplicates are easy to merge with `checklist move` and
  `done`, but the user gets grumpy when their list fills with junk.

### 3. Update / mark done / reopen

```
checklist update 3 --title "Better title" --details "Better body"
checklist done 3                        # mark finished
checklist reopen 3                      # move back to active
checklist move 7 --before 3             # reorder; --after also works
```

`checklist done` is the only way to "complete" an item. Don't delete items
unless the user explicitly asks — `checklist list` is more useful when the
finished history is preserved.

### 4. Inspect

```
checklist details 3                     # full item with details + children
```

`checklist details` returns the children list, which is how you discover
sub-tasks you didn't know existed.

## Coordination protocol — how to act well with the user

This is the part the README doesn't say and you have to internalize:

1. **Pull before you push.** Before adding anything, run `checklist list`
   (or `checklist find`) to see if the user already has an item for what
   you are about to do. If a match exists within ~80% title similarity,
   reuse it (update the details / add a child) instead of creating a
   duplicate. Duplicates are how you lose the user's trust in this tool.

2. **Match the user's granularity.** If their existing items are
   coarse-grained ("Ship the deploy script"), yours should be too. If theirs
   are fine-grained ("Add D1 binding", "Add custom domain", "Add deploy
   workflow"), match that. Look at 3-5 existing items in the same ledger
   before adding yours.

3. **Stay in the same ledger.** When the user says "the Work ledger" or "add
   this to Today", they mean the ledger by that name. When they say nothing,
   use the default ledger. Don't create new ledgers without asking.

4. **Update, don't re-add.** When scope changes on an item you previously
   added, prefer `checklist update --title / --details` over creating a new
   item and finishing the old one. The position in the list conveys "this is
   still the same work".

5. **Mark done as soon as the work is done.** Don't let items pile up in
   `active` after you've finished them — that breaks the user's mental model
   of "active = I need to look at this".

6. **Never edit D1 or call the Worker API directly.** This is the single
   biggest invariant of the project. Mutations must go through the CLI so the
   auth, ordering, and timestamp logic all run through one path. If the CLI
   can't do what you need, that's a CLI bug — fix it in this repo, don't
   work around it by writing SQL.

7. **When the user is mid-conversation and asks for a small thing** ("add
   'review PR' to my list"), do it in one command without ceremony. No need
   to dump the full list first unless you're unsure whether the item exists.

## Failure modes you must handle

- **401 invalid token** — the Worker secret rotated and your config is stale.
  Stop, tell the user, do not retry. They need to run
  `wrangler secret put ADMIN_TOKEN` and then `checklist login` on every
  machine.
- **Item-not-found** — your id or title substring didn't match anything in
  the chosen ledger. Run `checklist list --ledger <name>` to see what's
  there and pick the right ref. Don't guess ids.
- **Wrong ledger** — you added something to "Today" when the user meant
  "Work". Fix by `checklist move` is not possible across ledgers; instead,
  finish the wrong one and re-add to the right one. (Cross-ledger moves
  aren't implemented; if the user wants them, that's a feature request.)
- **Env var overriding the file** — if you set `CHECKLIST_ADMIN_TOKEN` in
  your shell to test something, it persists across commands and will mask
  the file's value even after you update the file. Unset it.

## Configuration recap

The CLI loads config in this order (first one wins):

1. `CHECKLIST_API_URL`, `CHECKLIST_ADMIN_TOKEN`, `CHECKLIST_LEDGER_ID`
   environment variables.
2. `~/.checklist-ledger.json` (or the Windows equivalent at
   `%USERPROFILE%\.checklist-ledger.json`).

To bootstrap, run `checklist login --api-key <token>`. To update only the
token, re-run `checklist login --api-key <new-token>` — it merges with the
existing file and preserves `defaultLedgerId` if you don't pass `--ledger-id`.

## Verification

After writing any item, verify with:

```
checklist details <id-or-title>
```

That returns the item with its children, details, and timestamps — enough
to confirm the write landed.

## See also

- `docs/CLI.md` — full command reference for humans.
- `README.md` — setup and deployment (D1, Cloudflare, GitHub Actions).
- `src/worker/http.ts:34-46` — auth check (bearer-token string equality).
- `src/cli/index.ts:93-110` — config loader (env var → file fallback).