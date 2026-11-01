import { NextResponse } from 'next/server';
import { originalBody } from '@grc/core/gmail';
import { getAppUser } from '@/lib/auth';
import { fetchAttachment, gmailForMailbox } from '@/lib/gmail';
import { createSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_INLINE_BYTES = 4_000_000;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * One email exactly as it was written (formatting, tables, inline pictures), fetched from Gmail.
 * Served as a locked-down page: no scripts, no forms, links open in a new tab.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAppUser();
  if (!user) return new NextResponse('Not signed in', { status: 401 });
  const { id } = await params;
  const supabase = await createSupabase();
  const { data: m } = await supabase.from('email_message').select('id, gmail_message_id, thread_id').eq('id', id).maybeSingle();
  const { data: t } = m ? await supabase.from('email_thread').select('mailbox_id').eq('id', m.thread_id).maybeSingle() : { data: null };
  if (!m || !t) return new NextResponse('Email not found', { status: 404 });

  let body: string;
  try {
    const api = await gmailForMailbox(t.mailbox_id as string);
    const msg = await api.getMessage(m.gmail_message_id as string);
    const o = originalBody(msg);
    body = o.html ?? `<pre style="white-space:pre-wrap;font:inherit">${esc(o.text ?? '(empty email)')}</pre>`;

    // Inline pictures (cid:...) are embedded directly, so they show without extra requests.
    let budget = MAX_INLINE_BYTES;
    for (const img of o.inline) {
      if (!body.includes(`cid:${img.cid}`)) continue;
      const part = findPart(msg.payload, img.partId);
      const attId = part?.body?.attachmentId;
      if (!attId || (part?.body?.size ?? 0) > budget) continue;
      const { data } = await fetchAttachment(api, { gmailMessageId: msg.id, gmailAttachmentId: attId, partId: img.partId });
      budget -= data.length;
      const mime = /^image\/(png|jpeg|gif|webp)$/i.test(part?.mimeType ?? '') ? part!.mimeType! : 'image/png';
      body = body.split(`cid:${img.cid}`).join(`data:${mime};base64,${data.toString('base64')}`);
    }
  } catch (e) {
    body = `<p style="color:#b91c1c">Could not load this email from Gmail: ${esc(e instanceof Error ? e.message : 'error')}</p>`;
  }

  const page = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<style>body{margin:16px;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#0f172a;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:8px 0 8px 4px;padding-left:12px;border-left:3px solid #cbd5e1;color:#475569}</style>
</head><body>${body}</body></html>`;
  return new NextResponse(page, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // No scripts, forms or plugins; only pictures and inline styles. Links open in a new tab.
      'Content-Security-Policy': "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'private, max-age=600',
    },
  });
}

type Part = { partId?: string; mimeType?: string; body?: { attachmentId?: string; size?: number }; parts?: Part[] };
function findPart(p: Part | undefined, partId: string): Part | undefined {
  if (!p) return undefined;
  if (p.partId === partId) return p;
  for (const c of p.parts ?? []) {
    const f = findPart(c, partId);
    if (f) return f;
  }
  return undefined;
}
