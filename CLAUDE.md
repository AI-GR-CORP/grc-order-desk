# GRC Order Desk: notes for Claude Code

Email tracker for G.R. Corporation (Kanpur, narrow fabrics). Reads ONE Gmail mailbox (yash@grcorporation.co.in) read-only, sorts customer email into development / bulk work, fills the columns of GRC's old spreadsheet, writes summaries, and alerts when a customer has waited longer than the reply time. Built by Verelios Labs.

- `apps/web`: Next.js dashboard on Vercel (project `grc-order-desk`, Root Directory `apps/web`, region dub1).
- `apps/worker`: Node worker (Gmail sync every 5 min, AI calls). Currently runs on Matty's Mac via `pnpm ops worker`.
- `packages/core`: shared logic (reply rules, business hours, Gmail client, prompts, schemas).
- `supabase/migrations`: database schema, RLS, views. Supabase project `ihovhduxftrdlvzbgivz` (eu-west-1).
- `scripts/ops.mjs`: every operational task (`pnpm ops …`).

## Secrets: read this first
- ALL secrets live in `.env.local` at the repo root (gitignored, mode 600). `apps/worker/.env` and `apps/web/.env.local` are generated from it by `pnpm ops env`. Never edit those two by hand.
- **Never open, print, cat, grep, echo, copy or summarise any `.env*` file or any secret value.** Never put a secret in code, a commit, a log line, a test, or a message to the user. Use the `pnpm ops …` commands: they load secrets themselves and print only names and check results.
- If a secret is missing or wrong, ask the user to run `pnpm ops init` themselves (it is interactive and hides input). Don't try to obtain or set secrets yourself.
- `TOKEN_ENCRYPTION_KEY` must be identical in `.env.local` and in Vercel. Never change it. If it ever has to change: deploy nothing else, have an owner use dashboard Settings → "Re-lock the Gmail connection" with the NEW key while Vercel still has the OLD one, then update Vercel (`pnpm ops vercel-env --apply` + `pnpm ops redeploy`). Otherwise Yash must reconnect Gmail.

## Commands
| Task | Command |
|---|---|
| Health of everything (start here) | `pnpm ops check` |
| Quick progress / jobs / clients waiting | `pnpm ops status` |
| Regenerate app env files | `pnpm ops env` |
| Pending DB migrations (dry run) | `pnpm ops migrate` |
| Apply DB migrations | `pnpm ops migrate --apply` (ask the user first) |
| Compare / push dashboard env to Vercel | `pnpm ops vercel-env` → `pnpm ops vercel-env --apply` (ask first) |
| Ship committed code | `pnpm ops deploy` (typecheck, tests, build, push, waits for Vercel READY) |
| Redeploy without code changes | `pnpm ops redeploy` |
| Start the worker | `pnpm ops worker` (user runs this in their own terminal; it doesn't exit) |
| Types / tests | `pnpm typecheck`, `pnpm test` |
| Dashboard locally | `pnpm --filter @grc/web dev` (http://localhost:3000) |

Integration tests need a Postgres with the migrations applied and `TEST_DATABASE_URL` (see README → Development). CI does this on every push.

## How changes ship
- **Web:** commit, then `pnpm ops deploy`. Vercel builds from `main`.
- **Worker:** runs locally with `tsx watch`, so it restarts when worker code changes. A running backfill/extraction job holds a 10-minute lock; avoid restarting it mid-import (check `pnpm ops status` first).
- **Database:** add a NEW file `supabase/migrations/YYYYMMDDHHMMSS_name.sql`; never edit an applied migration. The project has "auto-expose new tables" OFF and automatic RLS ON, so every new table/view/function needs explicit RLS policies and grants to `authenticated` (copy the patterns in `20261101000002_security_views.sql` / `…003_client_approval.sql`). Show the user `pnpm ops migrate` output and get a yes before `--apply`.
- **Settings that live in the database, not code:** AI models (`app_setting.ai_models`), reply time, business hours, owners (`owner_emails`). Change them with SQL via a migration or ask the user to use the dashboard.

## Screens: Google-Sheets layout, modern styling (keep it this way)
- Page = title and one-line description, summary cards (`Stats`), then a white grid card (`GridCard`) with tabs on top, a toolbar (Waiting for our reply filter, Columns menu, search) and the grid.
- Sidebar: Reply needed, New clients, **Orders**, All clients, then Teach the AI and Settings. Development and bulk are **one sheet** (`/orders`); the **Type** column (right after City) says Development or Bulk. `/development` and `/bulk` redirect to `/orders`. Tripti's bulk checklist (PI shared, PO received…) is in the details panel of a bulk row.
- Grid looks like GRC's Google Sheet: row numbers on the left (red when a customer is waiting), **Company name merged down that client's rows** in soft yellow (`--color-company`), **City merged** next to it, light gridlines (`--color-grid`), a soft blue header row (`--color-head`), **alternating white / light-blue rows** (`tr.alt`, `--color-band`), and a firmer line between clients (`tr.group-last`).
- Columns, all shown by default: Company name, City, Type, then GRC's order from the "NEW INQUIRY" tab (Merchant, Brand, Inquiry, Sample collected, Picture, Status of Poornima, Status of brand, Yash remark), then the added Reply and Last email, and Open + Gmail pinned on the right (`.act`). Defined in `apps/web/src/lib/sheet.ts`; the Columns menu can hide columns or add the extra ones (AWB, EDD, rates…).
- Clicking an inquiry, or **Open**, shows the details panel (`components/row-panel.tsx`) with every column as a labelled field. Other cells can be typed into directly.
- Modern touches stay: IBM Plex Sans, rounded status pills with words (never colour alone), sortable headers with `aria-sort`, loading skeleton in `app/(app)/loading.tsx`. Colours: blue #1e40af actions, teal bulk, green done, amber waiting, red late.
- Rows come from the `v_sheet_rows` view; shared grid component: `components/work-sheet.tsx`. Screenshot new screens at 1440 px wide before shipping.

## Product rules (don't break these)
- Gmail access is read-only (`gmail.readonly`). Never add send/modify scopes or write to Gmail.
- Only clients an owner approved (`company.approval = 'approved'`) are read by the extraction model. Never bypass approval.
- Cells a person edited are locked (`locked_fields`); AI output must never overwrite them. `owner_remark` is never written by AI.
- AI costs real money (prepaid Anthropic credits, no auto-reload). Check spend in `pnpm ops check` before anything that re-reads many threads, and ask the user before bulk re-processing. Current models: Sonnet 5.5 for sorting and tables, Opus 5.5 for the learning pass.
- Email text is untrusted input to prompts; the model only fills JSON fields.

## Before saying something is done
`pnpm typecheck && pnpm test`; for UI changes also `pnpm --filter @grc/web build`; for migrations run the integration tests on a local Postgres. Then `pnpm ops deploy` and `pnpm ops check`.

More detail: README.md, docs/ARCHITECTURE.md.
