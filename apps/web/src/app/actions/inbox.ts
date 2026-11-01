'use server';
import { revalidatePath } from 'next/cache';
import { assertUser } from '@/lib/auth';
import { createSupabase } from '@/lib/supabase/server';
import { run, type ActionResult } from './result';

/** Marks a conversation as read for the signed-in person (opening it does this). */
export async function markThreadRead(threadId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await assertUser();
    const supabase = await createSupabase();
    const { error } = await supabase.from('thread_read').upsert({ user_id: user.id, thread_id: threadId, read_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    revalidatePath('/inbox');
  });
}

/** Marks every customer conversation as read for the signed-in person. */
export async function markAllRead(): Promise<ActionResult<{ count: number }>> {
  return run(async () => {
    const user = await assertUser();
    const supabase = await createSupabase();
    const { data, error } = await supabase.from('v_inbox').select('thread_id').eq('unread', true).limit(5000);
    if (error) throw new Error(error.message);
    const now = new Date().toISOString();
    const rows = (data ?? []).map((r) => ({ user_id: user.id, thread_id: r.thread_id as string, read_at: now }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e } = await supabase.from('thread_read').upsert(rows.slice(i, i + 500));
      if (e) throw new Error(e.message);
    }
    revalidatePath('/inbox');
    return { count: rows.length };
  });
}
