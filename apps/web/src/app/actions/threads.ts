'use server';
import { revalidatePath } from 'next/cache';
import { THREAD_CATEGORIES } from '@grc/core';
import { assertUser } from '@/lib/auth';
import { createSupabase } from '@/lib/supabase/server';
import { run, type ActionResult } from './result';

function refresh(id?: string) {
  revalidatePath('/');
  if (id) revalidatePath(`/threads/${id}`);
}

export async function snoozeThread(id: string, minutes: number): Promise<ActionResult> {
  return run(async () => {
    await assertUser();
    const supabase = await createSupabase();
    const until = new Date(Date.now() + Math.min(Math.max(minutes, 5), 7 * 24 * 60) * 60000).toISOString();
    const { error } = await supabase.from('email_thread').update({ snoozed_until: until }).eq('id', id);
    if (error) throw new Error(error.message);
    refresh(id);
  });
}

/** "Handled on WhatsApp / phone": stops the alert until the customer writes again. */
export async function markHandledOffline(id: string, note: string): Promise<ActionResult> {
  return run(async () => {
    const user = await assertUser();
    const supabase = await createSupabase();
    const { error } = await supabase
      .from('email_thread')
      .update({
        reply_state: 'handled_offline',
        handled_offline_at: new Date().toISOString(),
        handled_offline_note: (note.trim() || 'Handled outside email') + ` — ${user.email}`,
        awaiting_reply_since: null,
        reply_due_at: null,
      })
      .eq('id', id);
    if (error) throw new Error(error.message);
    refresh(id);
  });
}

export async function setThreadCategory(id: string, category: string): Promise<ActionResult> {
  return run(async () => {
    const user = await assertUser();
    if (!THREAD_CATEGORIES.includes(category as never)) throw new Error('Unknown category.');
    const supabase = await createSupabase();
    const { data: cur } = await supabase.from('email_thread').select('category').eq('id', id).single();
    const { error } = await supabase.from('email_thread').update({ category, category_locked: true, needs_review: false }).eq('id', id);
    if (error) throw new Error(error.message);
    await supabase.from('correction').insert({ entity: 'email_thread', entity_id: id, field: 'category', ai_value: cur?.category ?? null, human_value: category, corrected_by: user.id });
    refresh(id);
    revalidatePath('/review');
  });
}

export async function setThreadCompany(id: string, companyId: string | null): Promise<ActionResult> {
  return run(async () => {
    const user = await assertUser();
    const supabase = await createSupabase();
    const { data: cur } = await supabase.from('email_thread').select('company_id').eq('id', id).single();
    const { error } = await supabase.from('email_thread').update({ company_id: companyId, company_locked: true, needs_review: false }).eq('id', id);
    if (error) throw new Error(error.message);
    // Items found in this thread move with it.
    if (companyId) {
      await supabase.from('dev_item').update({ company_id: companyId }).eq('primary_thread_id', id);
      await supabase.from('bulk_order').update({ company_id: companyId }).eq('primary_thread_id', id);
    }
    await supabase.from('correction').insert({ entity: 'email_thread', entity_id: id, field: 'company_id', ai_value: cur?.company_id ?? null, human_value: companyId, corrected_by: user.id });
    refresh(id);
    revalidatePath('/review');
  });
}

export async function markThreadReviewed(id: string): Promise<ActionResult> {
  return run(async () => {
    await assertUser();
    const supabase = await createSupabase();
    await supabase.from('email_thread').update({ needs_review: false }).eq('id', id);
    revalidatePath('/review');
  });
}

/** Re-fetch the thread from Gmail and run the AI again. Picked up by the worker within seconds. */
export async function reprocessThread(id: string): Promise<ActionResult> {
  return run(async () => {
    await assertUser();
    const supabase = await createSupabase();
    const { data: t } = await supabase.from('email_thread').select('mailbox_id').eq('id', id).single();
    if (!t) throw new Error('Thread not found.');
    const { error } = await supabase.rpc('enqueue_job', {
      p_kind: 'reprocess_thread', p_mailbox: t.mailbox_id, p_payload: { threadId: id, force: true },
      p_dedupe: `reprocess:${id}`, p_priority: 20,
    });
    if (error) throw new Error(error.message);
  });
}
