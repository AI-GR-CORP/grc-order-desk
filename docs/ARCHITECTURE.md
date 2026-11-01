# Architecture

## Flow of one email

1. **Sync** (`jobs/sync.ts`) — every 5 minutes Gmail is asked only for changes since the saved `historyId`. If that checkpoint has expired (worker down for days), the last 7 days are re-read instead. Each changed thread is fetched whole.
2. **Ingest** (`pipeline/ingest.ts`) — messages are stored once (keyed by Gmail id). Bodies are cleaned: quoted history, disclaimers and short signatures removed; forwarded content kept. Direction is decided from GRC's domains: inbound, outbound (GRC → customer) or internal. Promotions/Social mail is labelled marketing without an AI call.
3. **Triage** (`pipeline/triage.ts`, Haiku 5.5) — each external email gets a category (development, bulk, payment, courier, lab report, marketing, internal, vendor, other) and "needs a reply?". The thread category is derived from its emails unless someone set it by hand.
4. **Company** (`pipeline/companies.ts`) — matched by known contact, then by business domain. Personal Gmail/Yahoo senders match only through contacts.
5. **Extraction** (`pipeline/extract.ts` + `apply.ts`) — tracked threads of **approved** clients only (`company.approval`). Approving a client queues `extract_company`, which reads that client's threads oldest first. The model sees the thread (first email + as many recent ones as fit), the customer's existing items, and the knowledge profile; it returns the sheet's columns, a stage, summaries and bulk checklist steps as validated JSON (structured outputs). Writes happen in one transaction; hand-edited fields (`locked_fields`) are never overwritten; duplicates are caught by product code / PO / PI.
6. **Reply state** (`pipeline/reply.ts`, `core/reply.ts`) — the clock starts at the first customer email after GRC's last reply that needs an answer, and runs only in working hours. "Possibly replied" if GRC emailed that contact from another thread.
7. **Dashboard** — reads through RLS; `v_needs_reply` + Supabase Realtime drive the pop-up.

## First import (`jobs/backfill.ts`)

`ingesting → triaging → discovery → awaiting_review`, resumable at every stage (progress is saved on the mailbox row). Triage uses the Message Batches API (half price) above 50 emails. Discovery builds the customer list, team list and glossary, all flagged for review. Extraction (`jobs/extract-backfill.ts`) starts only after a person presses "Fill the tables"; threads of one customer run in order so items aren't duplicated, different customers run in parallel.

## Job queue

Postgres table `job`, claimed with `FOR UPDATE SKIP LOCKED`, leased with heartbeats, retried with exponential backoff, de-duplicated by `dedupe_key`. Run more worker containers to scale; no Redis needed.

## Security

- Gmail access is `gmail.readonly`. The refresh token is AES-256-GCM encrypted; the column isn't granted to dashboard users at all.
- Every table has RLS. Only users in `app_user` read anything; owner-only actions are checked in SQL (`is_app_admin()`).
- The worker uses the service role; the dashboard uses it only for signed thumbnail URLs and saving the Gmail token, after checking the user's role.
- Email text is treated as untrusted data in prompts; the model can only fill fields.

## Scaling notes

- Gmail quota and the Anthropic rate limits are the real ceilings; `AI_CONCURRENCY` and `WORKER_CONCURRENCY` control load.
- Supabase free tier: 500 MB database. Bodies are stored cleaned and marketing bodies are dropped, so this holds tens of thousands of emails. Move to Pro for daily backups before relying on it.
- `fetchAll` pages past PostgREST's 1,000-row cap; tables page by company in the UI.
- More mailboxes: the schema is per-mailbox already; connect another account from Settings.
