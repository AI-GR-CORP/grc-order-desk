# GRC Order Desk

Reads G.R. Corporation's main Gmail mailbox (read-only), sorts customer emails into **development** and **bulk** work, fills the same columns GRC used to keep in its customer-portfolio workbook, writes a short summary per thread and per item, and pops up an alert when a customer has waited longer than the reply time (default 60 minutes, counted in working hours).

Built by Verelios Labs.

```
 Gmail (read-only) ──► Worker (Node, every 5 min) ──► Claude API ──► Supabase Postgres ◄── Dashboard (Next.js)
                        sync · triage · extract                      RLS · Realtime · Storage    tables · alerts · edits
```

| Part | Where | What it does |
|---|---|---|
| `apps/web` | Vercel (or the worker server) | Dashboard, Google sign-in, Connect Gmail, edits, Excel export, the 1-hour pop-up |
| `apps/worker` | Small Linux server (Docker) | First import, 5-minute sync, AI calls, reply tracking, thumbnails |
| `packages/core` | shared | Domain rules, reply logic, business hours, Gmail client, AI prompts and schemas |
| `supabase/migrations` | Supabase | Tables, row-level security, views, auth hook |

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Setup, in order

### 1. Accounts (all owned by GR Corporation; add Verelios as a member)

- **Google Cloud** — create the project while signed in as GRC's **Workspace admin**.
  1. APIs & Services → Library → enable **Gmail API**.
  2. Google Auth Platform (OAuth consent screen) → Audience: **Internal**. Internal apps need no Google verification and their tokens don't expire after 7 days.
  3. Data access → add scope `.../auth/gmail.readonly`.
  4. Credentials → Create OAuth client → **Web application**. Authorised redirect URIs:
     - `https://<APP_URL>/api/gmail/callback` (Connect Gmail)
     - `https://<project>.supabase.co/auth/v1/callback` (dashboard sign-in)
     - `http://localhost:3000/api/gmail/callback` (local development, optional)
  - Internal means **only grcorporation.co.in Google accounts** can sign in with Google. Anyone else (e.g. Verelios) uses the "email me a sign-in link" option on the login page.
- **Supabase** — new project, region **Mumbai (ap-south-1)**. On the create screen: keep *Enable Data API* on; turn *Automatically expose new tables* **off** and *Enable automatic RLS* **on** (the migrations grant exactly what the dashboard needs).
  - Authentication → Providers → **Google**: paste the client ID/secret from above. Keep **Email** enabled (for sign-in links).
  - Authentication → URL configuration: Site URL = `APP_URL`; add `APP_URL/auth/callback` to redirect URLs (and `http://localhost:3000/auth/callback` for development).
- **Anthropic Console** — account on GRC's billing; create an API key.
- **Vercel** — the Hobby plan is for non-commercial use, so use **Pro** for this client, or run the dashboard on the worker server (`docker compose --profile web`).
- **Worker server** — any 1–2 GB Linux VM with Docker (Lightsail, EC2, Hetzner…).

### 2. Database

With the Supabase CLI (`supabase link --project-ref <ref>` then `supabase db push`), or paste each file in `supabase/migrations/` into the SQL editor **in order**.

Then set who becomes an owner on first sign-in (use the Google/email accounts that will sign in):

```sql
update app_setting
set value = '["owner@grcorporation.co.in", "you@verelios.com"]'
where key = 'owner_emails';
```

Anyone signing in from `grcorporation.co.in` gets staff access automatically (change under Settings → People). Others see an "ask for access" page until an owner lets them in.

### 3. Secrets

Generate one encryption key and use it in **both** apps:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy `apps/web/.env.example` and `apps/worker/.env.example` to `.env` and fill them. The worker's `DATABASE_URL` is Supabase → **Connect → Session pooler** (works over IPv4).

### 4. Deploy the dashboard (Vercel)

New project → import this repo → **Root Directory: `apps/web`** (Vercel detects pnpm and the workspace). Add the variables from `apps/web/.env.example`. Point the custom domain at it and make sure `APP_URL` matches.

### 5. Deploy the worker

```bash
git clone https://github.com/AI-GR-CORP/grc-order-desk.git && cd grc-order-desk
cp apps/worker/.env.example apps/worker/.env   # fill it
docker compose up -d --build
docker compose logs -f worker                  # expect "worker started"
curl -s localhost:8080                         # "ok"
```

Updating: `git pull && docker compose up -d --build`.

### 6. Go live

1. Sign in to the dashboard as an owner → **Settings → Connect Gmail** → sign in **as the mailbox being tracked** → allow read access.
2. The worker imports ~1,000 recent emails, sorts them, and builds a customer list and glossary (10–30 min). Reply tracking starts as soon as that finishes.
3. **Review** page: correct the "what the AI knows" notes (team, product codes, brands).
4. **New clients** page: approve the clients you want tracked, one card per client with all its conversations. Each approval reads that client's threads straight away; rows appear on Development and Bulk. Ignored clients are never read.

### 7. Old spreadsheet and accuracy check (optional but recommended)

```bash
cd apps/worker
pnpm import-sheet ./customer_portfolio.xlsx --dry-run          # see what will be imported
pnpm import-sheet ./customer_portfolio.xlsx                    # save as a baseline (no dashboard rows)
# …after step 6:
pnpm eval                                                      # % of sheet rows the AI found + per-column agreement
pnpm import-sheet ./customer_portfolio.xlsx --items --only-unmatched   # add the rows email didn't cover
```

If you'd rather show his sheet in the dashboard before Gmail is connected, run `--items` straight away (the accuracy check is then less meaningful).

---

## AI models and cost

Defaults (change any time in the `app_setting` row `ai_models`, no redeploy):

| Job | Model | Why |
|---|---|---|
| Sorting each email | Claude Sonnet 5.5 (`AI_EFFORT_TRIAGE=medium`) | A missed customer email is the expensive mistake |
| Filling the sheet columns + summaries | Claude Opus 5.5 (`AI_EFFORT_EXTRACT=high`) | Best extraction quality; reads PI/PO PDFs too |
| Building the customer list and glossary | Claude Opus 5.5 | Done once, sets up everything else |

What makes it accurate on GRC's mail (no fine-tuning is involved):
1. The knowledge profile from the learning pass, reviewed by a person.
2. Rows from GRC's own spreadsheet in every prompt (`import-sheet` first), so notes read the way the team writes them.
3. The last 40 corrections people made in the dashboard, so the same mistake isn't repeated.
4. PDF attachments (PI, PO, test reports) are read alongside the emails.
5. `pnpm eval` scores the result against the spreadsheet before go-live.

Settings → AI usage shows the real monthly cost. To cut cost later, set `extract` to `claude-sonnet-5-5`.

## Client approval

Nothing is read in depth until an owner approves the client. New senders' development/bulk emails are only sorted (cheap) and listed under **New clients**, with every conversation's first and latest email, what it's about, and whether it's waiting for a reply. Until approval: no extraction, no reply alerts, no rows. Approve one client or select several; "Ignore" hides a client for good (it can be restored from the Ignored tab). Conversations from personal Gmail/Yahoo addresses that couldn't be matched appear at the bottom: create a client from them, add them to an existing client, or mark them as not client work.

## Day to day

- **Needs reply** — customer emails nobody at GRC has answered. Clock runs in working hours (Settings → Reply rules). The pop-up repeats every 30 min while anything is overdue. "Handled on WhatsApp/phone" silences a thread until the customer writes again.
- **Development / Bulk** — click any cell to correct it. Corrected cells get a small dot and the AI never overwrites them. Every correction is logged.
- **Re-read with AI** on a thread page re-fetches it from Gmail and re-runs extraction.
- **Settings → AI usage** shows this month's estimated Claude cost.

**Replies must be visible in the tracked mailbox.** If staff answer from their own mailboxes without CC'ing it, threads look unanswered. Either CC the main mailbox, or extend the worker to read staff mailboxes via domain-wide delegation.

## Operations from the terminal (and Claude Code)

Every secret lives in **one file, `.env.local` at the repo root** (gitignored, mode 600). Create or refresh it with:

```bash
pnpm ops init      # reuses apps/worker/.env, asks (hidden) only for what's missing; optional Vercel token
```

Then everything else is one command:

```bash
pnpm ops check     # secrets, database, migrations, Gmail, worker, AI spend, Vercel, website
pnpm ops status    # quick: import progress, jobs, clients waiting
pnpm ops migrate   # pending DB migrations; --apply runs them
pnpm ops deploy    # typecheck + tests + build, push, wait for Vercel READY
pnpm ops redeploy  # after changing Vercel env vars
pnpm ops vercel-env [--apply]   # push the dashboard's variables from .env.local to Vercel
pnpm ops worker    # start the worker (keeps the Mac awake)
```

`ops` never prints secret values. `CLAUDE.md` tells Claude Code how to work in this repo, and `.claude/settings.json` blocks it from reading `.env` files and asks before pushes, deploys and migrations.

## Development

```bash
corepack enable && pnpm install
pnpm dev:web          # http://localhost:3000 (needs apps/web/.env)
pnpm dev:worker       # needs apps/worker/.env
pnpm typecheck && pnpm test
```

Integration tests need a Postgres with the migrations applied (`supabase start`, or plain Postgres + `supabase/tests/supabase-stubs.sql` as CI does) and `TEST_DATABASE_URL`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Sidebar says "Gmail disconnected" | Password changed or access revoked. Settings → Reconnect Gmail (history is kept). |
| "Sync delayed" | Worker down: `docker compose ps`, `docker compose logs worker`. |
| Import stuck | Settings shows the error; **Retry import** resumes where it stopped. |
| Google sign-in rejects a non-GRC account | Expected with an Internal app. Use the email sign-in link. |
| No pictures | Worker needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. |
