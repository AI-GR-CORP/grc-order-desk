'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { assertUser } from '@/lib/auth';
import { createAdmin } from '@/lib/supabase/admin';
import { createSupabase } from '@/lib/supabase/server';
import { run, type ActionResult } from './result';

const MAX_BYTES = 4_000_000;

function refreshSheets() {
  revalidatePath('/approvals');
  revalidatePath('/orders');
  revalidatePath('/clients', 'layout');
}

/**
 * Adds a picture to a row (a pasted screenshot, a WhatsApp photo…). The browser sends it already
 * resized to WebP: a large version (opened on click) and a small one for the grid.
 */
export async function addRowPicture(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await assertUser();
    const kind = String(form.get('kind'));
    const id = String(form.get('id'));
    const full = form.get('full');
    const thumb = form.get('thumb');
    if (!['dev', 'bulk', 'thread'].includes(kind) || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Unknown row.');
    if (!(full instanceof Blob) || !(thumb instanceof Blob)) throw new Error('No picture received.');
    for (const b of [full, thumb]) {
      if (b.type !== 'image/webp' && b.type !== 'image/jpeg') throw new Error('That file is not a picture.');
      if (b.size > MAX_BYTES) throw new Error('That picture is too large.');
    }
    const ext = full.type === 'image/webp' ? 'webp' : 'jpg';
    const name = randomUUID();
    const fullPath = `uploads/${name}.${ext}`;
    const thumbPath = `uploads/${name}-t.${ext}`;
    const admin = createAdmin();
    for (const [path, blob] of [[fullPath, full], [thumbPath, thumb]] as const) {
      const { error } = await admin.storage.from('thumbnails').upload(path, Buffer.from(await blob.arrayBuffer()), { contentType: blob.type });
      if (error) throw new Error(`Couldn't save the picture: ${error.message}`);
    }
    const supabase = await createSupabase();
    const { error } = await supabase.from('row_picture').insert({
      dev_item_id: kind === 'dev' ? id : null,
      bulk_order_id: kind === 'bulk' ? id : null,
      thread_id: kind === 'thread' ? id : null,
      source: 'upload',
      thumb_path: thumbPath,
      full_path: fullPath,
      width: Number(form.get('width')) || null,
      height: Number(form.get('height')) || null,
      position: 1000,
      added_by: user.id,
    });
    if (error) throw new Error(error.message);
    refreshSheets();
  });
}

/** Removes a picture from a row. It stays hidden: the AI won't put it back. */
export async function hideRowPicture(id: string): Promise<ActionResult> {
  return run(async () => {
    await assertUser();
    const supabase = await createSupabase();
    const { error } = await supabase.from('row_picture').update({ hidden: true }).eq('id', id);
    if (error) throw new Error(error.message);
    refreshSheets();
  });
}
