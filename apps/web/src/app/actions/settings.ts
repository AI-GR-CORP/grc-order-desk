'use server';
import { revalidatePath } from 'next/cache';
import { BusinessHoursSchema } from '@grc/core';
import { assertUser } from '@/lib/auth';
import { createSupabase } from '@/lib/supabase/server';
import { run, type ActionResult } from './result';

async function setSetting(key: string, value: unknown) {
  const supabase = await createSupabase();
  const { error } = await supabase.from('app_setting').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
  if (error) throw new Error(error.message);
}

export async function saveReplyRules(input: {
  slaMinutes: number;
  realertMinutes: number;
  nonMovingDays: number;
  days: number[];
  start: string;
  end: string;
  holidays: string;
}): Promise<ActionResult> {
  return run(async () => {
    await assertUser(true);
    if (!(input.slaMinutes >= 5 && input.slaMinutes <= 24 * 60)) throw new Error('Reply time must be between 5 minutes and 24 hours.');
    const hours = BusinessHoursSchema.parse({
      tz: 'Asia/Kolkata',
      days: input.days,
      start: input.start,
      end: input.end,
      holidays: input.holidays.split(/[\s,]+/).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    });
    await setSetting('reply_sla_minutes', Math.round(input.slaMinutes));
    await setSetting('realert_minutes', Math.max(5, Math.round(input.realertMinutes)));
    await setSetting('non_moving_days', Math.max(1, Math.round(input.nonMovingDays)));
    await setSetting('business_hours', hours);
    revalidatePath('/settings');
  });
}

export async function saveAccessRules(input: { loginDomains: string; ownerEmails: string }): Promise<ActionResult> {
  return run(async () => {
    await assertUser(true);
    const list = (s: string) => [...new Set(s.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
    await setSetting('login_domains', list(input.loginDomains));
    await setSetting('owner_emails', list(input.ownerEmails));
    revalidatePath('/settings');
  });
}

export async function saveColumnLabels(labels: Record<string, string>): Promise<ActionResult> {
  return run(async () => {
    await assertUser(true);
    const clean = Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    await setSetting('column_labels', clean);
    revalidatePath('/development');
    revalidatePath('/settings');
  });
}

export async function saveKnowledgeProfile(content: string): Promise<ActionResult> {
  return run(async () => {
    const user = await assertUser(true);
    const supabase = await createSupabase();
    const { data: max } = await supabase.from('knowledge_profile').select('version').order('version', { ascending: false }).limit(1);
    const version = ((max?.[0]?.version as number | undefined) ?? 0) + 1;
    await supabase.from('knowledge_profile').update({ active: false }).eq('active', true);
    const { error } = await supabase.from('knowledge_profile').insert({ version, content: content.trim(), active: true, created_by: user.id });
    if (error) throw new Error(error.message);
    revalidatePath('/review');
  });
}

export async function activateKnowledgeProfile(version: number): Promise<ActionResult> {
  return run(async () => {
    await assertUser(true);
    const supabase = await createSupabase();
    await supabase.from('knowledge_profile').update({ active: false }).eq('active', true);
    const { error } = await supabase.from('knowledge_profile').update({ active: true }).eq('version', version);
    if (error) throw new Error(error.message);
    revalidatePath('/review');
  });
}

export async function saveTeamMember(input: { id?: string; name: string; email: string; role: string; active: boolean }): Promise<ActionResult> {
  return run(async () => {
    await assertUser(true);
    const supabase = await createSupabase();
    const row = { name: input.name.trim(), email: input.email.trim().toLowerCase() || null, role: input.role.trim() || null, active: input.active };
    if (!row.name) throw new Error('Name is required.');
    const { error } = input.id
      ? await supabase.from('team_member').update(row).eq('id', input.id)
      : await supabase.from('team_member').insert(row);
    if (error) throw new Error(error.message);
    revalidatePath('/settings');
  });
}

export async function grantAccess(userId: string, role: 'owner' | 'admin' | 'staff'): Promise<ActionResult> {
  return run(async () => {
    await assertUser(true);
    const supabase = await createSupabase();
    const { error } = await supabase.rpc('grant_access', { p_user: userId, p_role: role });
    if (error) throw new Error(error.message);
    revalidatePath('/settings');
  });
}

export async function removeAccess(userId: string): Promise<ActionResult> {
  return run(async () => {
    const me = await assertUser(true);
    if (me.id === userId) throw new Error('You can’t remove your own access.');
    const supabase = await createSupabase();
    const { error } = await supabase.from('app_user').delete().eq('user_id', userId);
    if (error) throw new Error(error.message);
    revalidatePath('/settings');
  });
}

async function enqueue(kind: 'backfill' | 'extract_backfill', mailboxId: string, priority: number) {
  const supabase = await createSupabase();
  const { error } = await supabase.rpc('enqueue_job', {
    p_kind: kind, p_mailbox: mailboxId, p_payload: {}, p_dedupe: `${kind === 'backfill' ? 'backfill' : 'extract'}:${mailboxId}`, p_priority: priority,
  });
  if (error) throw new Error(error.message);
}

/** After reviewing the client directory: read every tracked thread and fill the tables. */
export async function startExtraction(mailboxId: string): Promise<ActionResult> {
  return run(async () => {
    await assertUser(true);
    await enqueue('extract_backfill', mailboxId, 5);
    revalidatePath('/review');
    revalidatePath('/settings');
  });
}

export async function retryImport(mailboxId: string): Promise<ActionResult> {
  return run(async () => {
    await assertUser(true);
    const supabase = await createSupabase();
    await supabase.from('mailbox').update({ status: 'pending' }).eq('id', mailboxId).eq('status', 'backfilling');
    await enqueue('backfill', mailboxId, 5);
    revalidatePath('/settings');
  });
}

export async function setMailboxPaused(mailboxId: string, paused: boolean): Promise<ActionResult> {
  return run(async () => {
    await assertUser(true);
    const supabase = await createSupabase();
    const { error } = await supabase.from('mailbox').update({ status: paused ? 'paused' : 'active' }).eq('id', mailboxId);
    if (error) throw new Error(error.message);
    revalidatePath('/settings');
  });
}
