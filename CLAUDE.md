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
| Sheet rows + pictures into the dashboard | `pnpm ops pictures ~/Downloads/<sheet>.xlsx` (check page) → `--apply` (ask first) |
| Re-sort conversations (Development / Bulk + topics) | `pnpm ops reclassify` (count + cost) → `pnpm ops reclassify --apply` (spends AI credit: ask first) |
| Types / tests | `pnpm typecheck`, `pnpm test` |
| Dashboard locally | `pnpm --filter @grc/web dev` (http://localhost:3000) |

Integration tests need a Postgres with the migrations applied and `TEST_DATABASE_URL` (see README → Development). CI does this on every push.

## How changes ship
- **Web:** commit, then `pnpm ops deploy`. Vercel builds from `main`.
- **Worker:** runs locally with `tsx watch`, so it restarts when worker code changes. A running backfill/extraction job holds a 10-minute lock; avoid restarting it mid-import (check `pnpm ops status` first).
- **Database:** add a NEW file `supabase/migrations/YYYYMMDDHHMMSS_name.sql`; never edit an applied migration. The project has "auto-expose new tables" OFF and automatic RLS ON, so every new table/view/function needs explicit RLS policies and grants to `authenticated` (copy the patterns in `20261101000002_security_views.sql` / `…003_client_approval.sql`). Show the user `pnpm ops migrate` output and get a yes before `--apply`.
- **Settings that live in the database, not code:** AI models (`app_setting.ai_models`), reply time, business hours, owners (`owner_emails`). Change them with SQL via a migration or ask the user to use the dashboard.

## Screens: Google-Sheets layout, modern styling (keep it this way)
- Keep the top **compact** (the owner asked for this): one slim title line (`TitleBar`: title + small `CountPill`s, actions on the right), no description lines, no summary boxes, no hint banners. Then the grid card (`GridCard`) with **one bar** (`GridBar`): tabs on the left, filters / Columns / search on the right. Everything else is the grid.
- Sidebar (`components/nav-rail.tsx`, 192px; **Collapse** shrinks it to a 68px icon strip, remembered per computer): Reply needed, New clients, **Orders**, All clients, then Teach the AI and Settings. Development and bulk are **one sheet** (`/orders`); the **Type** column (right after City) says Development or Bulk. `/development` and `/bulk` redirect to `/orders`. Tripti's bulk checklist (PI shared, PO received…) is in the details panel of a bulk row.
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

## Order types and topics (the owner wants this exactly right)

- Every order conversation is **one** type: `development` or `bulk`. Never "both"/"mixed" (a legacy value that `pnpm ops reclassify` replaces).
- Topics, shown under the type, any number: `complaint`, `payment_followup`, `pp_approval` (GRC: PP approval = sample approval), `lab_approval`. Payment follow-ups belong to an order (usually bulk), not a separate category.
- The decision is made per **whole conversation** by `apps/worker/src/pipeline/classify.ts` (model `ai_models.classify`), with keyword clues from `packages/core/src/ai/signals.ts`. Low confidence (< 0.8) or disagreement with a strong clue sets `type_needs_check` ("Please check" in the grid).
- A person's choice (`set_thread_type`, `confirm_thread_type`, `set_client_type` SQL functions) locks the conversation forever and is saved in `correction` with context. Those corrections are fed back into every classification prompt (that client's first). Never let the AI overwrite `category_locked` / `topics_locked`.
- Extraction follows the decided type: bulk conversations create bulk orders only, development ones development items only.
- `pnpm ops reclassify` shows the count and cost; `--apply` starts a re-sort. `pnpm ops check` shows how often the AI was right on rows the team checked.

## Inbox: the owner's goal is that GRC never needs Gmail for customer mail

- `/inbox` lists every conversation with an email from outside GRC, from the `v_inbox` view: bucket `customer` (order conversation, known client, or the AI said the sender is a customer), `filtered` (shown in the "Filtered out" safety-net tab; never hide mail silently), `dismissed` (a person said it isn't customer mail).
- Unread is per person (`thread_read`); opening a conversation marks it read.
- Attachments and original emails are fetched live from Gmail by `/api/attachments/[id]` and `/api/messages/[id]/original` (read-only scope; GRC users only; served sandboxed). Keep them locked down: no scripts from emails, ever.
- Doubtful AI answers (confidence < 0.8 or a clue disagrees) get a second opinion from `ai_models.classify_review` (Opus) before saving; if the two disagree, the row is flagged for a person.
- `pnpm ops check` shows coverage for the last 7 days (customer / filtered / newsletters / dismissed).

## Pictures (one product per row, like GRC's sheet)

- Pictures live in `row_picture`, one row each: a development item, a bulk order, or a conversation without rows. Sources: `sheet` (GRC's spreadsheet, with `sheet_ref` + `sheet_cell`), `email` (an attachment the extraction model named for that product in `picture_files`), `upload` (added in the details panel: file or ⌘V paste, resized in the browser).
- Never show a conversation's pictures on several products: a row with none of its own falls back to its conversation's email pictures only when that conversation has exactly one row (`getRowPictures` in `apps/web/src/lib/data.ts`).
- Removing a picture sets `hidden`; it must stay hidden (the AI must not re-add it).
- `pnpm ops pictures <sheet.xlsx>` writes `pictures-check.html` (every sheet row, its pictures and cells, and where it goes) and opens it; `--apply` imports rows + pictures and queues email pictures for every order conversation. Safe to re-run. `pictures-check.html` contains client pictures: never commit it.
- Email pictures are made for every order conversation (approved or not; downloads only, no AI cost).

## Skimming: subjects, digest, columns (the owner's 18 points)

- Yash skims every client in 5-10 minutes. ONE ROW PER ENQUIRY (conversation / product). A client's rows about the same brand and type sit together under one merged heading in the Brand column (`subjectBlocks` in `apps/web/src/lib/sheet.ts`) with Close all; meeting invites (`is_meeting`) join their brand's subject. Inquiry column = the short `title` only (no summaries: pointers live in the details panel). Customer reply / GRC reply are per enquiry, each with the date of the email it describes; GRC reply shows Pending whenever GRC owes the reply (`reply_state = awaiting`). Every row has its own Close (with Undo).
- Brand is the END brand (G-STAR, LYLE & SCOTT), never the customer company. Pointers: max 5, each under 15 words, specific. Both come from the conversation sort (`classify.ts`), with Customer reply / GRC reply (`customer_status` / `grc_status`), price quoted, sample status and enquiry ref.
- Grid columns: removed Sample collected, Status of Poornima, Yash remark (owner's request; don't add them back). Added Customer reply, GRC reply, Price quoted (dev `grc_rate`), Sample approval (dev `sample_approval`). Bulk progress shows in GRC reply. Type filter is in the Type column header.
- Close (subject / enquiry; a new customer email reopens a subject) and Skip (not order work; saved as a lesson) live in the details panel. Recall emails ("Recall: …") are never tracked. Signature logos (same sender, same image size, 3+ emails) are never pictures.

## Before saying something is done
`pnpm typecheck && pnpm test`; for UI changes also `pnpm --filter @grc/web build`; for migrations run the integration tests on a local Postgres. Then `pnpm ops deploy` and `pnpm ops check`.

More detail: README.md, docs/ARCHITECTURE.md.
