#!/usr/bin/env node
/**
 * GRC Order Desk: one entry point for running the project from a terminal (or from Claude Code).
 *
 *   pnpm ops init                 create/refresh .env.local (every secret, one file); asks only for what's missing
 *   pnpm ops env                  write apps/worker/.env and apps/web/.env.local from .env.local
 *   pnpm ops check                full health check: secrets, database, migrations, Gmail, AI, spend, Vercel, website
 *   pnpm ops status               quick view: import progress, jobs, clients waiting (database only)
 *   pnpm ops migrate [--apply]    list database migrations not yet applied; --apply runs them
 *   pnpm ops vercel-env [--apply] show / push the dashboard's environment variables to Vercel
 *   pnpm ops deploy [--fast]      typecheck + tests + build, git push, wait until Vercel is live
 *   pnpm ops redeploy             redeploy the current code (after changing Vercel env vars)
 *   pnpm ops worker               start the worker (keeps the Mac awake)
 *   pnpm ops reclassify [--apply]  re-sort conversations: Development / Bulk + topics (shows the cost first)
 *
 * Secrets live ONLY in .env.local at the repo root (gitignored, mode 600).
 * This script never prints a secret value: only names, lengths and check results.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS = join(ROOT, '.env.local');
const WORKER_ENV = join(ROOT, 'apps/worker/.env');
const WEB_ENV = join(ROOT, 'apps/web/.env.local');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const VERCEL_PROJECT_NAME = 'grc-order-desk';
const requireFromWorker = createRequire(join(ROOT, 'apps/worker/package.json'));

/* ------------------------------------------------------------------ output */
const c = { b: (s) => `\x1b[1m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` };
let failures = 0;
const ok = (m) => console.log(`  ${c.g('✓')} ${m}`);
const warn = (m) => console.log(`  ${c.y('!')} ${m}`);
const bad = (m) => { failures++; console.log(`  ${c.r('✗')} ${c.r(m)}`); };
const section = (m) => console.log(`\n${c.b(m)}`);
const die = (m) => { console.error(`\n${c.r('✗')} ${m}\n`); process.exit(1); };
const ago = (d) => {
  if (!d) return 'never';
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/* ------------------------------------------------------------------ env files */
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const readEnv = (p) => (existsSync(p) ? parseEnv(readFileSync(p, 'utf8')) : {});

/** Every value the project needs. `secret` values are never shown. */
const KEYS = [
  { section: 'Supabase' },
  { key: 'SUPABASE_URL', required: true, help: 'Project URL, e.g. https://xxxx.supabase.co' },
  { key: 'SUPABASE_ANON_KEY', required: true, secret: true, help: 'Supabase → Settings → API Keys → Legacy → anon (starts with eyJ)' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', required: true, secret: true, help: 'Supabase → Settings → API Keys → Legacy → service_role → Reveal' },
  { key: 'DATABASE_URL', required: true, secret: true, help: 'Supabase → Connect → Session pooler URI, with the database password filled in' },
  { section: 'Google sign-in and Gmail' },
  { key: 'GOOGLE_CLIENT_ID', required: true, help: 'Ends in .apps.googleusercontent.com' },
  { key: 'GOOGLE_CLIENT_SECRET', required: true, secret: true, help: 'Starts with GOCSPX-' },
  { section: 'App' },
  { key: 'APP_URL', required: true, default: 'https://grc-order-desk.vercel.app' },
  { key: 'LOGIN_DOMAIN', default: 'grcorporation.co.in' },
  { key: 'TOKEN_ENCRYPTION_KEY', required: true, secret: true, help: 'Must equal the value in Vercel. NEVER change without re-locking Gmail in Settings.' },
  { section: 'AI' },
  { key: 'ANTHROPIC_API_KEY', required: true, secret: true, help: 'Starts with sk-ant-' },
  { key: 'AI_PROVIDER', default: 'anthropic' },
  { key: 'AI_EFFORT_TRIAGE', default: 'medium' },
  { key: 'AI_EFFORT_EXTRACT', default: 'medium' },
  { key: 'AI_CONCURRENCY', default: '2' },
  { key: 'WORKER_CONCURRENCY', default: '2' },
  { key: 'LOG_LEVEL', default: 'info' },
  { section: 'Vercel (for ops check / deploy / vercel-env)' },
  { key: 'VERCEL_TOKEN', secret: true, help: 'vercel.com → Account Settings → Tokens → Create (scope: the AI-GR-COPR team)' },
  { key: 'VERCEL_PROJECT_ID', help: 'Filled in automatically from the token' },
  { key: 'VERCEL_TEAM_ID', help: 'Filled in automatically from the token' },
];

const VALIDATE = {
  SUPABASE_URL: (v) => /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(v) || 'should look like https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: (v) => /^(eyJ|sb_publishable_)/.test(v) || 'should start with eyJ',
  SUPABASE_SERVICE_ROLE_KEY: (v) => /^(eyJ|sb_secret_)/.test(v) || 'should start with eyJ',
  DATABASE_URL: (v) => (/^postgres(ql)?:\/\//.test(v) && !v.includes('[YOUR-PASSWORD]')) || 'should be a postgresql:// URI with the password filled in',
  GOOGLE_CLIENT_ID: (v) => v.endsWith('.apps.googleusercontent.com') || 'should end in .apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: (v) => v.startsWith('GOCSPX-') || 'should start with GOCSPX-',
  TOKEN_ENCRYPTION_KEY: (v) => Buffer.from(v, 'base64').length === 32 || 'should be 32 bytes of base64 (44 characters)',
  ANTHROPIC_API_KEY: (v) => v.startsWith('sk-ant-') || 'should start with sk-ant-',
  APP_URL: (v) => /^https?:\/\//.test(v) || 'should start with https://',
};

function loadSecrets({ required = true } = {}) {
  if (!existsSync(SECRETS)) {
    if (!required) return {};
    die(`No .env.local yet. Run:  pnpm ops init`);
  }
  const s = readEnv(SECRETS);
  for (const k of KEYS) if (k.key && s[k.key] === undefined && k.default !== undefined) s[k.key] = k.default;
  return s;
}

function writeEnvFile(path, values, header, sections = null) {
  const lines = [`# ${header}`, '# Generated/managed by scripts/ops.mjs. Never commit this file.', ''];
  if (sections) {
    for (const k of sections) {
      if (k.section) lines.push('', `# ---- ${k.section}`);
      else if (values[k.key] !== undefined) lines.push(`${k.key}=${values[k.key]}`);
    }
    for (const [key, v] of Object.entries(values)) if (!sections.some((k) => k.key === key)) lines.push(`${key}=${v}`);
  } else {
    for (const [key, v] of Object.entries(values)) if (v !== undefined) lines.push(`${key}=${v}`);
  }
  writeFileSync(path, lines.join('\n') + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
}

function workerEnvFrom(s) {
  return {
    DATABASE_URL: s.DATABASE_URL,
    DATABASE_SSL: s.DATABASE_SSL ?? 'require',
    SUPABASE_URL: s.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: s.SUPABASE_SERVICE_ROLE_KEY,
    GOOGLE_CLIENT_ID: s.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: s.GOOGLE_CLIENT_SECRET,
    TOKEN_ENCRYPTION_KEY: s.TOKEN_ENCRYPTION_KEY,
    AI_PROVIDER: s.AI_PROVIDER,
    ANTHROPIC_API_KEY: s.ANTHROPIC_API_KEY,
    AI_EFFORT_TRIAGE: s.AI_EFFORT_TRIAGE,
    AI_EFFORT_EXTRACT: s.AI_EFFORT_EXTRACT,
    AI_CONCURRENCY: s.AI_CONCURRENCY,
    WORKER_CONCURRENCY: s.WORKER_CONCURRENCY,
    LOG_LEVEL: s.LOG_LEVEL,
  };
}

/** The dashboard's variables. `local` = for `next dev` on this Mac. */
function webEnvFrom(s, { local }) {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: s.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: s.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: s.SUPABASE_SERVICE_ROLE_KEY,
    GOOGLE_CLIENT_ID: s.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: s.GOOGLE_CLIENT_SECRET,
    TOKEN_ENCRYPTION_KEY: s.TOKEN_ENCRYPTION_KEY,
    APP_URL: local ? 'http://localhost:3000' : s.APP_URL,
    NEXT_PUBLIC_LOGIN_DOMAIN: s.LOGIN_DOMAIN ?? '',
  };
  if (!local) env.ENABLE_EXPERIMENTAL_COREPACK = '1';
  return env;
}
const WEB_SECRET_KEYS = new Set(['SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_CLIENT_SECRET', 'TOKEN_ENCRYPTION_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']);

function missingRequired(s) {
  return KEYS.filter((k) => k.required && !s[k.key]).map((k) => k.key);
}

/* ------------------------------------------------------------------ prompts */
async function ask(question, { hidden = false } = {}) {
  if (!process.stdin.isTTY) die('This step needs an interactive terminal.');
  process.stdout.write(`  ${question}${hidden ? c.d(' (hidden)') : ''}: `);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let buf = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(buf.replace(/\x1b\[20[01]~/g, '').trim());
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (buf.length) {
            buf = buf.slice(0, -1);
            if (!hidden) process.stdout.write('\b \b');
          }
          continue;
        }
        buf += ch;
        if (!hidden) process.stdout.write(ch);
      }
    };
    stdin.on('data', onData);
  });
}

/* ------------------------------------------------------------------ vercel api */
async function vercel(s, method, path, body) {
  const url = new URL(`https://api.vercel.com${path}`);
  if (s.VERCEL_TEAM_ID) url.searchParams.set('teamId', s.VERCEL_TEAM_ID);
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${s.VERCEL_TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Vercel ${method} ${path.split('?')[0]}: ${res.status} ${json.error?.message ?? ''}`.trim());
  return json;
}

/** Finds the project and its team from just the token. */
async function resolveVercelIds(s) {
  const tryProject = async (teamId) => {
    const url = new URL(`https://api.vercel.com/v9/projects/${VERCEL_PROJECT_NAME}`);
    if (teamId) url.searchParams.set('teamId', teamId);
    const res = await fetch(url, { headers: { authorization: `Bearer ${s.VERCEL_TOKEN}` } });
    return res.ok ? res.json() : null;
  };
  let p = await tryProject(s.VERCEL_TEAM_ID || '');
  if (p) return { VERCEL_PROJECT_ID: p.id, VERCEL_TEAM_ID: s.VERCEL_TEAM_ID || p.accountId || '' };
  const teams = await fetch('https://api.vercel.com/v2/teams', { headers: { authorization: `Bearer ${s.VERCEL_TOKEN}` } }).then((r) => (r.ok ? r.json() : { teams: [] }));
  for (const t of teams.teams ?? []) {
    p = await tryProject(t.id);
    if (p) return { VERCEL_PROJECT_ID: p.id, VERCEL_TEAM_ID: t.id };
  }
  throw new Error(`Couldn't find a Vercel project named "${VERCEL_PROJECT_NAME}" with this token`);
}

/* ------------------------------------------------------------------ database */
function db(s) {
  const postgres = requireFromWorker('postgres');
  return postgres(s.DATABASE_URL, {
    ssl: (s.DATABASE_SSL ?? 'require') === 'disable' ? false : 'require',
    prepare: false,
    max: 1,
    connect_timeout: 20,
    onnotice: () => {},
  });
}

const MIGRATION_MARKERS = {
  // How to recognise migrations that were applied by hand in the SQL editor before this tool existed.
  '20261101000001': `select to_regclass('public.app_setting') is not null as ok`,
  '20261101000002': `select to_regprocedure('public.is_app_user()') is not null as ok`,
  '20261101000003': `select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'approval') as ok`,
};

async function migrationState(sql, { record }) {
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  const [{ exists }] = await sql`select to_regclass('public.ops_migration') is not null as exists`;
  if (!exists && record) {
    await sql.unsafe(`
      create table if not exists public.ops_migration (
        version text primary key, name text not null, applied_at timestamptz not null default now());
      alter table public.ops_migration enable row level security;
      revoke all on public.ops_migration from anon, authenticated;`);
  }
  const applied = new Set(exists ? (await sql`select version from public.ops_migration`).map((r) => r.version) : []);
  for (const f of files) {
    const v = f.slice(0, 14);
    if (applied.has(v) || !MIGRATION_MARKERS[v]) continue;
    const [{ ok: done }] = await sql.unsafe(MIGRATION_MARKERS[v]);
    if (done) {
      applied.add(v);
      if (record) await sql`insert into public.ops_migration (version, name) values (${v}, ${f}) on conflict do nothing`;
    }
  }
  return { files, pending: files.filter((f) => !applied.has(f.slice(0, 14))) };
}

function decrypt(token, keyB64) {
  const [v, iv, tag, ct] = String(token).split('.');
  if (v !== 'v1') throw new Error('format');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

/* ------------------------------------------------------------------ commands */
async function cmdInit() {
  section('Setting up .env.local (one file with every secret)');
  const fromWorker = readEnv(WORKER_ENV);
  const fromWeb = readEnv(WEB_ENV);
  const s = { ...readEnv(SECRETS) };
  const seed = {
    SUPABASE_URL: fromWorker.SUPABASE_URL ?? fromWeb.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: fromWeb.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: fromWorker.SUPABASE_SERVICE_ROLE_KEY,
    DATABASE_URL: fromWorker.DATABASE_URL,
    GOOGLE_CLIENT_ID: fromWorker.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: fromWorker.GOOGLE_CLIENT_SECRET,
    TOKEN_ENCRYPTION_KEY: fromWorker.TOKEN_ENCRYPTION_KEY,
    ANTHROPIC_API_KEY: fromWorker.ANTHROPIC_API_KEY,
  };
  for (const k of ['AI_PROVIDER', 'AI_EFFORT_TRIAGE', 'AI_EFFORT_EXTRACT', 'AI_CONCURRENCY', 'WORKER_CONCURRENCY', 'LOG_LEVEL', 'DATABASE_SSL']) seed[k] = fromWorker[k];
  for (const [k, v] of Object.entries(seed)) if (s[k] === undefined && v !== undefined && v !== '') s[k] = v;

  // Google values straight from the downloaded client_secret_….json, if still missing.
  if (!s.GOOGLE_CLIENT_ID || !s.GOOGLE_CLIENT_SECRET) {
    const dl = join(homedir(), 'Downloads');
    const json = existsSync(dl) ? readdirSync(dl).filter((f) => /^client_secret_.*\.json$/.test(f)).sort().pop() : undefined;
    if (json) {
      const j = JSON.parse(readFileSync(join(dl, json), 'utf8'));
      const w = j.web ?? j.installed ?? {};
      s.GOOGLE_CLIENT_ID ??= w.client_id;
      s.GOOGLE_CLIENT_SECRET ??= w.client_secret;
    }
  }
  for (const k of KEYS) if (k.key && s[k.key] === undefined && k.default !== undefined) s[k.key] = k.default;

  const reused = Object.keys(seed).filter((k) => s[k]);
  if (reused.length) ok(`Reused from the existing worker settings: ${reused.length} values`);

  for (const k of KEYS) {
    if (!k.key || !k.required || s[k.key]) continue;
    console.log(`  ${c.d(k.help ?? '')}`);
    for (;;) {
      const v = await ask(k.key, { hidden: Boolean(k.secret) });
      const valid = VALIDATE[k.key]?.(v) ?? true;
      if (v && valid === true) {
        s[k.key] = v;
        break;
      }
      warn(v ? `${k.key} ${valid}` : `${k.key} is required`);
    }
  }
  for (const [key, check] of Object.entries(VALIDATE)) {
    const r = s[key] ? check(s[key]) : true;
    if (r !== true) die(`${key} ${r}. Fix it in .env.local or delete that line and run init again.`);
  }

  if (!s.VERCEL_TOKEN) {
    console.log(`\n  ${c.d('Optional: a Vercel token lets "ops check/deploy/vercel-env" talk to Vercel. Press Enter to skip.')}`);
    console.log(`  ${c.d(KEYS.find((k) => k.key === 'VERCEL_TOKEN').help)}`);
    const t = await ask('VERCEL_TOKEN', { hidden: true });
    if (t) s.VERCEL_TOKEN = t;
  }
  if (s.VERCEL_TOKEN && !s.VERCEL_PROJECT_ID) {
    try {
      Object.assign(s, await resolveVercelIds(s));
      ok(`Found the Vercel project (${s.VERCEL_PROJECT_ID})`);
    } catch (e) {
      warn(`Vercel: ${e.message}. You can fill VERCEL_PROJECT_ID / VERCEL_TEAM_ID in .env.local later.`);
    }
  }

  writeEnvFile(SECRETS, s, 'GRC Order Desk: every secret and setting. Source of truth for all other env files.', KEYS);
  ok('Saved .env.local (readable only by your Mac user)');
  cmdEnv();
  console.log(`\n  Next:  ${c.b('pnpm ops check')}\n`);
}

function cmdEnv() {
  const s = loadSecrets();
  const missing = missingRequired(s);
  if (missing.length) die(`.env.local is missing: ${missing.join(', ')}. Run: pnpm ops init`);
  writeEnvFile(WORKER_ENV, workerEnvFrom(s), 'Worker settings (generated from .env.local by `pnpm ops env`).');
  writeEnvFile(WEB_ENV, webEnvFrom(s, { local: true }), 'Dashboard settings for local `next dev` (generated from .env.local by `pnpm ops env`).');
  ok('Wrote apps/worker/.env and apps/web/.env.local from .env.local');
}

async function cmdCheck({ quick = false } = {}) {
  const s = loadSecrets();

  if (!quick) {
    section('Secrets');
    const missing = missingRequired(s);
    if (missing.length) bad(`Missing in .env.local: ${missing.join(', ')} (run pnpm ops init)`);
    else ok(`.env.local has all ${KEYS.filter((k) => k.required).length} required values`);
    for (const [key, check] of Object.entries(VALIDATE)) {
      const r = s[key] ? check(s[key]) : true;
      if (r !== true) bad(`${key} ${r}`);
    }
    const w = readEnv(WORKER_ENV);
    const drift = Object.entries(workerEnvFrom(s)).filter(([k, v]) => (v ?? '') !== (w[k] ?? '')).map(([k]) => k);
    if (drift.length) warn(`apps/worker/.env differs from .env.local (${drift.join(', ')}). Run: pnpm ops env`);
    else ok('apps/worker/.env matches .env.local');
  }

  section('Database');
  let sql;
  try {
    sql = db(s);
    const [{ n }] = await sql`select count(*)::int as n from app_setting`;
    ok(`Connected (${n} settings)`);
    const { files, pending } = await migrationState(sql, { record: false });
    if (pending.length) warn(`${pending.length} migration(s) not applied: ${pending.join(', ')}. Run: pnpm ops migrate`);
    else ok(`All ${files.length} migrations applied`);
    const [m] = await sql`select value from app_setting where key = 'ai_models'`;
    if (m) ok(`AI models: sorting ${m.value.triage}, tables ${m.value.extract}, learning ${m.value.discovery}`);

    section('Mailbox and worker');
    const mbs = await sql`select email, status, backfill_stage, backfill_progress, backfill_target, last_synced_at, last_error, refresh_token_enc from mailbox`;
    if (!mbs.length) warn('No Gmail connected yet (Settings → Connect Gmail)');
    for (const mb of mbs) {
      const p = mb.backfill_progress ?? {};
      const progress = [
        p.messages !== undefined ? `${p.messages}/${mb.backfill_target} emails imported` : null,
        p.triageBatch ? `sorting batch: ${p.triageBatch.succeeded ?? 0} done, ${p.triageBatch.processing ?? 0} processing` : null,
        p.toExtract ? `${p.extracted ?? 0}/${p.toExtract} conversations read` : null,
      ].filter(Boolean).join('; ');
      ok(`${mb.email}: ${mb.status}, stage ${mb.backfill_stage}${progress ? ` (${progress})` : ''}`);
      if (mb.status === 'active') {
        const stale = !mb.last_synced_at || Date.now() - new Date(mb.last_synced_at).getTime() > 15 * 60000;
        (stale ? warn : ok)(`Last Gmail sync ${ago(mb.last_synced_at)}${stale ? ' (is the worker running? pnpm ops worker)' : ''}`);
      }
      if (mb.last_error) warn(`Last error: ${String(mb.last_error).slice(0, 200)}`);
      if (!quick && mb.refresh_token_enc) {
        let refresh;
        try {
          refresh = decrypt(mb.refresh_token_enc, s.TOKEN_ENCRYPTION_KEY);
          ok('Encryption key opens the saved Gmail connection');
        } catch {
          bad("TOKEN_ENCRYPTION_KEY can't open the saved Gmail connection (use Settings → Re-lock, see CLAUDE.md)");
        }
        if (refresh) {
          try {
            const r = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: s.GOOGLE_CLIENT_ID, client_secret: s.GOOGLE_CLIENT_SECRET }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) bad(`Google refused (${j.error ?? r.status}): ${j.error === 'invalid_grant' ? 'Gmail must be reconnected' : j.error === 'invalid_client' ? 'Google client ID/secret wrong' : j.error_description ?? ''}`);
            else {
              const prof = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { authorization: `Bearer ${j.access_token}` } }).then((x) => x.json());
              if (prof.emailAddress) ok(`Gmail readable: ${prof.emailAddress}`);
              else bad('Gmail profile check failed');
            }
          } catch (e) {
            bad(`Couldn't reach Google: ${e.message}`);
          }
        }
      }
    }
    const jobs = await sql`select status, count(*)::int as n from job group by status order by status`;
    ok(`Jobs: ${jobs.map((j) => `${j.n} ${j.status}`).join(', ') || 'none'}`);
    const running = await sql`select kind, attempts, updated_at from job where status = 'running' order by updated_at`;
    for (const j of running) console.log(`      ${c.d(`running: ${j.kind} (attempt ${j.attempts}, since ${ago(j.updated_at)})`)}`);
    const failedJobs = await sql`select kind, last_error, updated_at from job where status = 'failed' and updated_at > now() - interval '3 days' order by updated_at desc limit 3`;
    for (const j of failedJobs) warn(`Failed ${j.kind} ${ago(j.updated_at)}: ${String(j.last_error).slice(0, 160)}`);
    const retrying = await sql`select kind, attempts, last_error from job where status = 'queued' and attempts > 0 order by updated_at desc limit 3`;
    for (const j of retrying) warn(`Retrying ${j.kind} (attempt ${j.attempts}): ${String(j.last_error).slice(0, 160)}`);

    section('Clients and data');
    const q = await sql`select approval, count(*)::int as n from v_client_queue group by approval`;
    const counts = Object.fromEntries(q.map((r) => [r.approval, r.n]));
    ok(`Clients: ${counts.pending ?? 0} waiting for approval, ${counts.approved ?? 0} approved, ${counts.rejected ?? 0} ignored`);
    const [d] = await sql`select (select count(*)::int from dev_item) as dev, (select count(*)::int from bulk_order) as bulk, (select count(*)::int from email_thread) as threads, (select count(*)::int from email_message) as emails`;
    ok(`${d.emails} emails in ${d.threads} conversations; ${d.dev} development rows, ${d.bulk} bulk orders`);
    const [nr] = await sql`select count(*)::int as n from v_needs_reply where reply_state = 'awaiting'`;
    ok(`${nr.n} conversations waiting for a reply`);

    // Order types: how many, how many still need a person's check, and how often the AI was right.
    const [ty] = await sql`
      select count(*) filter (where category = 'development')::int as dev,
             count(*) filter (where category = 'bulk')::int as bulk,
             count(*) filter (where category = 'mixed')::int as mixed,
             count(*) filter (where type_needs_check and type_checked_at is null)::int as to_check,
             count(*) filter (where type_checked_at is not null and category in ('development','bulk'))::int as checked,
             count(*) filter (where type_checked_at is not null and exists (
               select 1 from correction c where c.entity = 'email_thread' and c.entity_id = email_thread.id and c.field in ('order_type','topics')))::int as corrected
      from email_thread`;
    ok(`Order conversations: ${ty.dev} development, ${ty.bulk} bulk${ty.mixed ? `, ${ty.mixed} still "mixed" (run pnpm ops reclassify)` : ''}`);
    if (ty.to_check) warn(`${ty.to_check} marked "Please check" in the dashboard (AI unsure or a clue disagrees)`);
    if (ty.checked) {
      const right = ty.checked - ty.corrected;
      ok(`Checked by your team: ${ty.checked}. AI was right on ${right} (${Math.round((right / ty.checked) * 100)}%), corrected ${ty.corrected}`);
    }
    const [cls] = await sql`select backfill_progress->'classify' as p from mailbox where backfill_progress ? 'classify' limit 1`;
    if (cls?.p && !cls.p.finishedAt) {
      const b = cls.p.batch;
      ok(`Re-sorting: ${cls.p.done ?? 0} of ${cls.p.total ?? '?'} done${b ? ` (batch: ${b.succeeded ?? 0} ready, ${b.processing ?? 0} in progress)` : ''}`);
    } else if (cls?.p?.finishedAt) {
      ok(`Last re-sort ${ago(cls.p.finishedAt)}: ${cls.p.total} conversations, ${cls.p.changed} changed type, ${cls.p.toCheck} to check`);
    }

    section('AI spend this month (estimate)');
    const spend = await sql`select purpose, count(*)::int as calls, count(*) filter (where not ok)::int as failed, coalesce(sum(cost_usd), 0)::float as usd
                            from ai_run where created_at >= date_trunc('month', now()) group by purpose order by purpose`;
    const total = spend.reduce((n, r) => n + r.usd, 0);
    if (!spend.length) ok('No AI calls yet this month');
    for (const r of spend) console.log(`      ${r.purpose.padEnd(10)} ${String(r.calls).padStart(5)} calls  ${String(r.failed).padStart(3)} failed  $${r.usd.toFixed(2)}`);
    if (spend.length) ok(`Total ≈ $${total.toFixed(2)} (exact balance: platform.claude.com)`);
    const [recentFail] = await sql`select count(*)::int as n, max(error) as err from ai_run where not ok and created_at > now() - interval '1 hour'`;
    if (recentFail.n > 5) warn(`${recentFail.n} AI calls failed in the last hour. Latest: ${String(recentFail.err).slice(0, 160)}`);
  } catch (e) {
    bad(`Database: ${e.message}`);
  } finally {
    await sql?.end({ timeout: 2 }).catch(() => {});
  }

  if (quick) return finish();

  section('Services');
  try {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': s.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } });
    if (r.ok) ok('Anthropic key works');
    else bad(`Anthropic key rejected (${r.status})`);
  } catch (e) {
    bad(`Anthropic: ${e.message}`);
  }
  try {
    const r = await fetch(`${s.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/bucket/thumbnails`, {
      headers: { apikey: s.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${s.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (r.ok) ok('Supabase service key works (picture storage)');
    else bad(`Supabase service key rejected (${r.status})`);
  } catch (e) {
    bad(`Supabase: ${e.message}`);
  }

  section('Vercel and website');
  if (!s.VERCEL_TOKEN || !s.VERCEL_PROJECT_ID) {
    warn('VERCEL_TOKEN not set: skipping deployment checks (add it with pnpm ops init)');
  } else {
    try {
      const { deployments = [] } = await vercel(s, 'GET', `/v6/deployments?projectId=${s.VERCEL_PROJECT_ID}&target=production&limit=1`);
      const dep = deployments[0];
      if (!dep) warn('No production deployment found');
      else {
        const state = dep.readyState ?? dep.state;
        (state === 'READY' ? ok : state === 'ERROR' ? bad : warn)(
          `Latest production deploy: ${state}, ${ago(dep.created)}, "${(dep.meta?.githubCommitMessage ?? '').split('\n')[0].slice(0, 70)}"`,
        );
      }
      const { envs = [] } = await vercel(s, 'GET', `/v9/projects/${s.VERCEL_PROJECT_ID}/env`);
      const have = new Set(envs.filter((e) => (e.target ?? []).includes('production')).map((e) => e.key));
      const want = Object.keys(webEnvFrom(s, { local: false }));
      const missing = want.filter((k) => !have.has(k));
      if (missing.length) bad(`Vercel production is missing: ${missing.join(', ')} (pnpm ops vercel-env --apply)`);
      else ok(`Vercel has all ${want.length} dashboard variables`);
    } catch (e) {
      bad(e.message);
    }
  }
  try {
    const r = await fetch(`${s.APP_URL.replace(/\/$/, '')}/login`, { redirect: 'manual' });
    if (r.ok) ok(`Website up: ${s.APP_URL}`);
    else bad(`Website returned ${r.status}: ${s.APP_URL}/login`);
  } catch (e) {
    bad(`Website unreachable: ${e.message}`);
  }
  finish();
}

function finish() {
  console.log('');
  if (failures) {
    console.log(c.r(`${failures} problem(s) found.`));
    process.exitCode = 1;
  } else console.log(c.g('Everything checks out.'));
}

async function cmdMigrate(apply) {
  const s = loadSecrets();
  const sql = db(s);
  try {
    section(apply ? 'Applying database migrations' : 'Database migrations (dry run)');
    const { files, pending } = await migrationState(sql, { record: apply });
    for (const f of files) console.log(`  ${pending.includes(f) ? c.y('pending') : c.g('applied')}  ${f}`);
    if (!pending.length) return ok('Nothing to apply');
    if (!apply) return warn(`${pending.length} pending. Review them, then run: pnpm ops migrate --apply`);
    for (const f of pending) {
      const text = readFileSync(join(MIGRATIONS, f), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into public.ops_migration (version, name) values (${f.slice(0, 14)}, ${f})`;
      });
      ok(`Applied ${f}`);
    }
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

async function cmdVercelEnv(apply) {
  const s = loadSecrets();
  if (!s.VERCEL_TOKEN) die('VERCEL_TOKEN is not set. Run: pnpm ops init');
  if (!s.VERCEL_PROJECT_ID) Object.assign(s, await resolveVercelIds(s));
  const want = webEnvFrom(s, { local: false });
  const missing = Object.entries(want).filter(([, v]) => !v).map(([k]) => k).filter((k) => k !== 'NEXT_PUBLIC_LOGIN_DOMAIN');
  if (missing.length) die(`.env.local is missing values for: ${missing.join(', ')}`);
  const { envs = [] } = await vercel(s, 'GET', `/v9/projects/${s.VERCEL_PROJECT_ID}/env`);
  section(apply ? 'Updating Vercel environment variables' : 'Vercel environment variables (dry run: names only)');
  const target = ['production', 'preview'];
  for (const [key, value] of Object.entries(want)) {
    const existing = envs.find((e) => e.key === key && (e.target ?? []).includes('production'));
    console.log(`  ${existing ? 'update' : c.y('create')}  ${key}`);
    if (!apply) continue;
    if (existing) {
      await vercel(s, 'PATCH', `/v9/projects/${s.VERCEL_PROJECT_ID}/env/${existing.id}`, { value, target });
    } else {
      await vercel(s, 'POST', `/v10/projects/${s.VERCEL_PROJECT_ID}/env`, { key, value, target, type: WEB_SECRET_KEYS.has(key) ? 'sensitive' : 'encrypted' });
    }
  }
  const extra = envs.filter((e) => !(e.key in want)).map((e) => e.key);
  if (extra.length) warn(`Also in Vercel (left alone): ${[...new Set(extra)].join(', ')}`);
  if (apply) ok('Done. The site uses new values after a redeploy: pnpm ops redeploy');
  else warn('Nothing changed. To push these values from .env.local: pnpm ops vercel-env --apply');
}

function run(cmd, args, opts = {}) {
  console.log(c.d(`  $ ${cmd} ${args.join(' ')}`));
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
  if (r.status !== 0) die(`${cmd} ${args.join(' ')} failed`);
}
const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

async function waitForVercel(s, sha) {
  if (!s.VERCEL_TOKEN || !s.VERCEL_PROJECT_ID) return warn('No VERCEL_TOKEN: check the deploy at vercel.com');
  section('Waiting for Vercel');
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 15 * 60000) {
    const { deployments = [] } = await vercel(s, 'GET', `/v6/deployments?projectId=${s.VERCEL_PROJECT_ID}&target=production&limit=10`);
    const dep = deployments.find((d) => d.meta?.githubCommitSha === sha);
    const state = dep ? dep.readyState ?? dep.state : 'WAITING_FOR_GIT';
    if (state !== last) console.log(`  ${new Date().toLocaleTimeString()}  ${state}`);
    last = state;
    if (state === 'READY') return ok(`Live at ${s.APP_URL}`);
    if (state === 'ERROR' || state === 'CANCELED') return bad(`Deploy ${state}. Logs: ${dep.inspectorUrl ?? 'vercel.com → Deployments'}`);
    await new Promise((r) => setTimeout(r, 10000));
  }
  bad('Timed out after 15 minutes waiting for Vercel');
}

async function cmdDeploy({ redeploy, fast }) {
  const s = loadSecrets();
  if (git(['status', '--porcelain'])) die('There are uncommitted changes. Commit them first (git status).');
  if (redeploy) {
    run('git', ['commit', '--allow-empty', '-m', 'chore: redeploy']);
  } else if (!fast) {
    section('Checking before deploy');
    run('pnpm', ['typecheck']);
    run('pnpm', ['test']);
    run('pnpm', ['--filter', '@grc/web', 'build'], {
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: s.SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: s.SUPABASE_ANON_KEY },
    });
  }
  section('Pushing to GitHub (Vercel deploys from main)');
  run('git', ['push']);
  await waitForVercel(s, git(['rev-parse', 'HEAD']));
  finish();
}

function cmdWorker() {
  cmdEnv();
  const args = ['--filter', '@grc/worker', 'dev'];
  const child = process.platform === 'darwin' ? spawn('caffeinate', ['-i', 'pnpm', ...args], { cwd: ROOT, stdio: 'inherit' }) : spawn('pnpm', args, { cwd: ROOT, stdio: 'inherit' });
  console.log(c.d('  Worker running. Ctrl+C stops it. Keep the Mac awake and on charge.'));
  child.on('exit', (code) => process.exit(code ?? 0));
}

/* ------------------------------------------------------------------ main */
const [cmd, ...rest] = process.argv.slice(2);
const flag = (f) => rest.includes(f);
/** Re-sort every order-like conversation into Development / Bulk + topics with the current AI rules. */
async function cmdReclassify(apply) {
  const s = loadSecrets();
  const sql = db(s);
  try {
    const [mb] = await sql`select id, email from mailbox order by created_at limit 1`;
    if (!mb) die('No mailbox connected yet.');
    const onlyNew = flag('--only-new');
    const candidate = sql`(
      t.category in ('development','bulk','mixed','payment')
      or exists (select 1 from email_message m where m.thread_id = t.id and m.direction <> 'internal'
                 and m.triage->>'category' in ('development','bulk','payment','lab_report')))`;
    const [n] = await sql`
      select count(*)::int as total,
             count(*) filter (where not (t.category_locked and t.topics_locked))::int as todo,
             count(*) filter (where t.category_locked and t.topics_locked)::int as kept,
             count(*) filter (where t.classified_at is null and not (t.category_locked and t.topics_locked))::int as never,
             coalesce(sum(least(16000, (select coalesce(sum(length(coalesce(m.body_clean, m.snippet, ''))), 0) from email_message m where m.thread_id = t.id)))
                      filter (where not (t.category_locked and t.topics_locked)), 0)::bigint as chars
      from email_thread t where t.mailbox_id = ${mb.id} and ${candidate}`;
    const todo = onlyNew ? n.never : n.todo;
    const [{ value: models }] = await sql`select value from app_setting where key = 'ai_models'`;
    const model = models?.classify ?? 'claude-sonnet-5-5';
    const price = { 'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] }[model] ?? [4, 20];
    const avgChars = n.todo ? Number(n.chars) / n.todo : 0;
    const inTok = todo * (4500 + avgChars / 3.5);
    const outTok = todo * 1500; // thinking + answer
    const usd = ((inTok * price[0] + outTok * price[1]) / 1e6) * (todo >= 50 ? 0.5 : 1);
    section('Re-sort conversations: Development / Bulk + topics');
    ok(`${n.total} order-like conversations in ${mb.email}`);
    ok(`${n.kept} were checked by your team and stay exactly as they are`);
    ok(`${todo} will be sorted again by ${model}${onlyNew ? ' (only never-sorted ones)' : ''}`);
    ok(`Estimated cost: about $${Math.max(0.01, usd).toFixed(2)}${todo >= 50 ? ' (half-price batch; usually done within an hour)' : ''}`);
    if (!apply) {
      console.log(`\n  Nothing started. Run ${c.b('pnpm ops reclassify --apply')} to start it (the worker must be running).\n`);
      return;
    }
    const [j] = await sql`
      insert into job (kind, mailbox_id, payload, dedupe_key, priority)
      values ('classify_backfill', ${mb.id}, ${sql.json({ all: !onlyNew })}, ${'classify_backfill:' + mb.id}, 5)
      on conflict (dedupe_key) where dedupe_key is not null and status in ('queued','running') do nothing
      returning id`;
    if (j) ok(`Started (job ${j.id}). Follow it with ${c.b('pnpm ops status')}.`);
    else warn('A re-sort is already running. Follow it with pnpm ops status.');
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

const commands = {
  init: cmdInit,
  env: cmdEnv,
  check: () => cmdCheck(),
  status: () => cmdCheck({ quick: true }),
  migrate: () => cmdMigrate(flag('--apply')),
  'vercel-env': () => cmdVercelEnv(flag('--apply')),
  deploy: () => cmdDeploy({ redeploy: false, fast: flag('--fast') }),
  redeploy: () => cmdDeploy({ redeploy: true }),
  worker: cmdWorker,
  reclassify: () => cmdReclassify(flag('--apply')),
};
if (!commands[cmd]) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 15).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
  process.exit(cmd ? 1 : 0);
}
Promise.resolve(commands[cmd]()).catch((e) => die(e.message));
