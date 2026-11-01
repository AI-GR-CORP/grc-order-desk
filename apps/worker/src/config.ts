import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (Supabase → Connect → Session pooler)'),
  DATABASE_SSL: z.enum(['require', 'prefer', 'disable']).default('require'),
  SUPABASE_URL: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  TOKEN_ENCRYPTION_KEY: optionalString,

  AI_PROVIDER: z.enum(['anthropic', 'bedrock']).default('anthropic'),
  ANTHROPIC_API_KEY: optionalString,
  AWS_REGION: optionalString,
  /** JSON map from Claude API model id to Bedrock model id / inference profile. */
  BEDROCK_MODEL_MAP: optionalString,
  /** Effort per purpose; empty string = don't send the parameter. */
  AI_EFFORT_TRIAGE: z.string().default('low'),
  AI_EFFORT_EXTRACT: z.string().default('medium'),
  AI_CONCURRENCY: z.coerce.number().int().positive().default(4),
  /** Use the Message Batches API for backfill triage above this many emails. */
  AI_BATCH_MIN: z.coerce.number().int().nonnegative().default(50),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  SYNC_INTERVAL_MINUTES: z.coerce.number().positive().default(5),
  BACKFILL_QUERY: z.string().default('-in:chats -category:promotions -category:social -category:forums'),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof EnvSchema>;

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid worker environment:\n${lines}`);
  }
  cached = parsed.data;
  return cached;
}

/** Throws a clear error if a value needed for this code path is missing. */
export function need<K extends keyof Config>(key: K): NonNullable<Config[K]> {
  const v = config()[key];
  if (v === undefined || v === null || v === '') throw new Error(`${String(key)} is not set`);
  return v as NonNullable<Config[K]>;
}
