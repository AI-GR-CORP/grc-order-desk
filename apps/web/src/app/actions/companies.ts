'use server';
import { revalidatePath } from 'next/cache';
import { companyKey } from '@grc/core';
import { assertUser } from '@/lib/auth';
import { createSupabase } from '@/lib/supabase/server';
import { run, type ActionResult } from './result';

export async function updateCompany(
  id: string,
  patch: { name?: string; region?: string | null; city?: string | null; country?: string | null },
): Promise<ActionResult> {
  return run(async () => {
    await assertUser();
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = patch.name.replace(/\s+/g, ' ').trim();
      if (!name) throw new Error('Company name can’t be empty.');
      update.name = name;
      update.name_key = companyKey(name);
    }
    for (const k of ['region', 'city', 'country'] as const) if (patch[k] !== undefined) update[k] = patch[k]?.trim() || null;
    const supabase = await createSupabase();
    const { error } = await supabase.from('company').update(update).eq('id', id);
    if (error) throw new Error(error.message);
    revalidatePath('/review');
    revalidatePath(`/clients/${id}`);
  });
}

export async function confirmCompany(id: string): Promise<ActionResult> {
  return run(async () => {
    await assertUser();
    const supabase = await createSupabase();
    await supabase.from('company').update({ needs_review: false }).eq('id', id);
    revalidatePath('/review');
  });
}

export async function mergeCompany(fromId: string, intoId: string): Promise<ActionResult> {
  return run(async () => {
    await assertUser();
    if (fromId === intoId) throw new Error('Pick a different company to merge into.');
    const supabase = await createSupabase();
    const { error } = await supabase.rpc('merge_company', { p_from: fromId, p_into: intoId });
    if (error) throw new Error(error.message);
    revalidatePath('/review');
    revalidatePath('/clients');
  });
}
