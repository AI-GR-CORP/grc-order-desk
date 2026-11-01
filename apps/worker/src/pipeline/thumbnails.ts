import sharp from 'sharp';
import type { GmailApi } from '@grc/core/gmail';
import type { Ctx } from '../context';
import { errorMessage } from '../errors';

const MAX_PER_THREAD = 8;
const MIN_BYTES = 15_000; // skip logos and signature icons
const MAX_BYTES = 15_000_000;

/** Creates small WebP thumbnails of customer photos/swatches for the "Picture" column. */
export async function ensureThumbnails(ctx: Ctx, api: GmailApi, threadId: string): Promise<void> {
  if (!ctx.storage) return;
  const rows = await ctx.sql<{ id: string; gmail_message_id: string; gmail_attachment_id: string }[]>`
    select a.id, m.gmail_message_id, a.gmail_attachment_id
    from attachment a join email_message m on m.id = a.message_id
    where m.thread_id = ${threadId} and a.kind = 'image' and a.thumbnail_path is null
      and coalesce(a.size_bytes, 0) between ${MIN_BYTES} and ${MAX_BYTES}
      and coalesce(a.mime_type, '') not in ('image/gif', 'image/svg+xml')
    order by m.sent_at desc
    limit ${MAX_PER_THREAD}`;

  for (const a of rows) {
    try {
      const raw = await api.getAttachment(a.gmail_message_id, a.gmail_attachment_id);
      const webp = await sharp(raw, { failOn: 'none' })
        .rotate()
        .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 72 })
        .toBuffer();
      const path = `${threadId}/${a.id}.webp`;
      const { error } = await ctx.storage.storage.from('thumbnails').upload(path, webp, { contentType: 'image/webp', upsert: true });
      if (error) throw error;
      await ctx.sql`update attachment set thumbnail_path = ${path} where id = ${a.id}`;
    } catch (e) {
      ctx.log.warn({ attachmentId: a.id, err: errorMessage(e) }, 'thumbnail failed');
      // Mark so we don't retry a broken image forever.
      await ctx.sql`update attachment set thumbnail_path = '' where id = ${a.id}`;
    }
  }
}
