'use server';
import { revalidatePath } from 'next/cache';
import { companyKey, type ClientApproval } from '@grc/core';
import { domainOf, isFreemail, isInternal } from '@grc/core/mail';
import { assertUser } from '@/lib/auth';
import { getSettings } from '@/lib/data';
import { createSupabase } from '@/lib/supabase/server';
import { run, type ActionResult } from './result';

type Supabase = Awaited<ReturnType<typeof createSupabase>>;

function refresh() {
  revalidatePath('/approvals');
  revalidatePath('/');
  revalidatePath('/clients');
  revalidatePath('/development');
  revalidatePath('/bulk');
}

/** Queue "read this client's conversations now" for the worker. */
async function queueRead(supabase: Supabase, companyId: string) {
  const { error } = await supabase.rpc('enqueue_job', {
    p_kind: 'extract_company',
    p_mailbox: null,
    p_payload: { companyId },
    p_dedupe: `extract_company:${companyId}`,
    p_priority: 8,
  });
  if (error) throw new Error(error.message);
}

/** Approve, ignore or move back to waiting. Approving starts reading that client's emails. */
export async function setClientApproval(ids: string[], approval: ClientApproval): Promise<ActionResult<{ count: number }>> {
  return run(async () => {
    const user = await assertUser(true);
    if (ids.length === 0) throw new Error('Pick at least one client.');
    const supabase = await createSupabase();
    const { error } = await supabase
      .from('company')
      .update({
        approval,
        approval_at: approval === 'pending' ? null : new Date().toISOString(),
        approval_by: approval === 'pending' ? null : user.id,
        needs_review: false,
      })
      .in('id', ids);
    if (error) throw new Error(error.message);
    if (approval === 'approved') for (const id of ids) await queueRead(supabase, id);
    refresh();
    return { count: ids.length };
  });
}

/** Attach the senders of these threads to a client (so future emails match automatically). */
async function fileSenders(supabase: Supabase, threadIds: string[], companyId: string) {
  const { data } = await supabase.from('v_thread_brief').select('first_from_email, first_from_name').in('id', threadIds);
  const senders = new Map<string, string | null>();
  for (const r of (data ?? []) as { first_from_email: string | null; first_from_name: string | null }[]) {
    if (r.first_from_email) senders.set(r.first_from_email.toLowerCase(), r.first_from_name);
  }
  if (senders.size === 0) return [] as string[];
  const rows = [...senders].map(([email, name]) => ({ email, name, company_id: companyId }));
  await supabase.from('contact').upsert(rows, { onConflict: 'email', ignoreDuplicates: true });
  await supabase.from('contact').update({ company_id: companyId }).in('email', [...senders.keys()]).is('company_id', null);
  return [...senders.keys()];
}

/** Unmatched conversations → a brand-new, approved client. */
export async function approveAsNewClient(threadIds: string[], name: string): Promise<ActionResult> {
  return run(async () => {
    const user = await assertUser(true);
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) throw new Error('Give the client a name.');
    if (threadIds.length === 0) throw new Error('No conversations selected.');
    const supabase = await createSupabase();
    const settings = await getSettings(supabase);

    const key = companyKey(clean);
    const { data: existing } = await supabase.from('company').select('id').eq('name_key', key).is('merged_into', null).limit(1);
    let companyId = existing?.[0]?.id as string | undefined;
    const now = new Date().toISOString();
    if (companyId) {
      await supabase.from('company').update({ approval: 'approved', approval_at: now, approval_by: user.id, needs_review: false }).eq('id', companyId);
    } else {
      const { data, error } = await supabase
        .from('company')
        .insert({ name: clean, name_key: key, approval: 'approved', approval_at: now, approval_by: user.id })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Could not create the client.');
      companyId = data.id as string;
    }

    const { error } = await supabase.from('email_thread').update({ company_id: companyId, company_locked: true, needs_review: false }).in('id', threadIds);
    if (error) throw new Error(error.message);
    const emails = await fileSenders(supabase, threadIds, companyId);
    const domains = [...new Set(emails.filter((e) => !isFreemail(e, settings.freemail_domains) && !isInternal(e, settings.internal_domains)).map(domainOf))];
    if (domains.length) {
      const { data: c } = await supabase.from('company').select('domains').eq('id', companyId).single();
      const merged = [...new Set([...((c?.domains as string[]) ?? []), ...domains])];
      await supabase.from('company').update({ domains: merged }).eq('id', companyId);
    }
    await queueRead(supabase, companyId);
    refresh();
  });
}

/** Unmatched conversations → an existing client. Read straight away if that client is approved. */
export async function addThreadsToClient(threadIds: string[], companyId: string): Promise<ActionResult> {
  return run(async () => {
    await assertUser(true);
    if (!companyId) throw new Error('Pick a client.');
    const supabase = await createSupabase();
    const { error } = await supabase.from('email_thread').update({ company_id: companyId, company_locked: true, needs_review: false }).in('id', threadIds);
    if (error) throw new Error(error.message);
    await fileSenders(supabase, threadIds, companyId);
    const { data: c } = await supabase.from('company').select('approval').eq('id', companyId).single();
    if (c?.approval === 'approved') await queueRead(supabase, companyId);
    refresh();
  });
}

/** Not client work after all (vendor, personal, spam that slipped through). */
export async function ignoreThreads(threadIds: string[]): Promise<ActionResult> {
  return run(async () => {
    await assertUser(true);
    const supabase = await createSupabase();
    const { error } = await supabase.from('email_thread').update({ category: 'ignored', category_locked: true, needs_review: false }).in('id', threadIds);
    if (error) throw new Error(error.message);
    refresh();
  });
}
