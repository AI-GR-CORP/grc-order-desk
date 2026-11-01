import { z } from 'zod';

export const BusinessHoursSchema = z.object({
  tz: z.string().default('Asia/Kolkata'),
  /** 0 = Sunday … 6 = Saturday. Empty array = clock runs 24/7. */
  days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5, 6]),
  start: z.string().regex(/^\d{2}:\d{2}$/).default('10:00'),
  end: z.string().regex(/^\d{2}:\d{2}$/).default('19:00'),
  /** Dates (YYYY-MM-DD, local) when the clock does not run. */
  holidays: z.array(z.string()).default([]),
});
export type BusinessHours = z.infer<typeof BusinessHoursSchema>;

export const AiModelsSchema = z.object({
  triage: z.string().default('claude-sonnet-5-5'),
  extract: z.string().default('claude-opus-5-5'),
  discovery: z.string().default('claude-opus-5-5'),
  /** Decides each conversation's order type (development / bulk) and topics. */
  classify: z.string().default('claude-sonnet-5-5'),
  /** Second opinion when the first answer is unsure or contradicts a clue ('' turns it off). */
  classify_review: z.string().default('claude-opus-5-5'),
});

export const AppSettingsSchema = z.object({
  reply_sla_minutes: z.number().int().positive().default(60),
  business_hours: BusinessHoursSchema.default(BusinessHoursSchema.parse({})),
  non_moving_days: z.number().int().positive().default(21),
  internal_domains: z.array(z.string()).default(['grcorporation.co.in', 'grcorporation.com']),
  freemail_domains: z
    .array(z.string())
    .default(['gmail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'rediffmail.com', 'icloud.com']),
  login_domains: z.array(z.string()).default(['grcorporation.co.in']),
  owner_emails: z.array(z.string()).default([]),
  ai_models: AiModelsSchema.default(AiModelsSchema.parse({})),
  column_labels: z.record(z.string(), z.string()).default({}),
  realert_minutes: z.number().int().positive().default(30),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

/** Build typed settings from app_setting rows; unknown keys are ignored, bad values fall back to defaults. */
export function parseSettings(rows: readonly { key: string; value: unknown }[]): AppSettings {
  const raw: Record<string, unknown> = {};
  for (const r of rows) raw[r.key] = r.value;
  const parsed = AppSettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Drop only the invalid keys rather than everything.
  const bad = new Set(parsed.error.issues.map((i) => String(i.path[0])));
  for (const k of bad) delete raw[k];
  return AppSettingsSchema.parse(raw);
}
