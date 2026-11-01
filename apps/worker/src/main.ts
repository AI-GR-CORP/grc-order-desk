import { createServer } from 'node:http';
import { config } from './config';
import { createCtx } from './context';
import { createDb } from './db';
import { log } from './log';
import { startRunner } from './runner';
import { startScheduler } from './scheduler';

async function main() {
  const cfg = config();
  const sql = createDb();
  await sql`select 1`; // fail fast on a bad DATABASE_URL
  const ctx = createCtx(sql);
  if (!ctx.storage) log.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: picture thumbnails are disabled');

  const runner = startRunner(ctx, cfg.WORKER_CONCURRENCY);
  const stopScheduler = startScheduler(ctx);
  log.info({ concurrency: cfg.WORKER_CONCURRENCY, syncMinutes: cfg.SYNC_INTERVAL_MINUTES, ai: cfg.AI_PROVIDER }, 'worker started');

  // Health endpoint for Docker / uptime checks.
  const port = Number(process.env.PORT ?? 8080);
  const server = createServer(async (_req, res) => {
    try {
      await sql`select 1`;
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    } catch {
      res.writeHead(503).end('db unavailable');
    }
  }).listen(port);

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    stopScheduler();
    server.close();
    await runner.stop();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  log.fatal({ err: e instanceof Error ? e.message : String(e) }, 'worker failed to start');
  process.exit(1);
});
