import { NextResponse } from 'next/server';
import { getAppUser } from '@/lib/auth';
import { fetchAttachment, gmailForMailbox } from '@/lib/gmail';
import { createAdmin } from '@/lib/supabase/admin';
import { createSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Opened in the browser; anything else is downloaded (never rendered as a web page). */
const VIEWABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);

/** Opens or downloads one email attachment, straight from Gmail. GRC users only. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAppUser();
  if (!user) return new NextResponse('Not signed in', { status: 401 });
  const { id } = await params;

  // Read through the user's own session, so the database's access rules apply.
  const supabase = await createSupabase();
  const { data: a } = await supabase
    .from('attachment')
    .select('id, message_id, part_id, gmail_attachment_id, filename, mime_type')
    .eq('id', id)
    .maybeSingle();
  if (!a) return new NextResponse('Attachment not found', { status: 404 });
  const { data: m } = await supabase.from('email_message').select('gmail_message_id, thread_id').eq('id', a.message_id).maybeSingle();
  const { data: t } = m ? await supabase.from('email_thread').select('mailbox_id').eq('id', m.thread_id).maybeSingle() : { data: null };
  if (!m || !t) return new NextResponse('Email not found', { status: 404 });

  try {
    const api = await gmailForMailbox(t.mailbox_id as string);
    const { data, attachmentId } = await fetchAttachment(api, {
      gmailMessageId: m.gmail_message_id as string,
      gmailAttachmentId: a.gmail_attachment_id as string,
      partId: a.part_id as string,
    });
    if (attachmentId !== a.gmail_attachment_id) {
      await createAdmin().from('attachment').update({ gmail_attachment_id: attachmentId }).eq('id', a.id);
    }
    const type = String(a.mime_type ?? '').toLowerCase();
    const view = VIEWABLE.has(type) && !new URL(req.url).searchParams.has('download');
    const name = String(a.filename || 'attachment').replace(/[\r\n"]/g, '');
    const headers: Record<string, string> = {
      'Content-Type': view ? type : 'application/octet-stream',
      'Content-Disposition': `${view ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Length': String(data.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    };
    // Browsers won't show PDFs in a sandboxed page; images and downloads get the sandbox.
    if (type !== 'application/pdf') headers['Content-Security-Policy'] = 'sandbox';
    return new NextResponse(new Uint8Array(data), { headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not load the attachment';
    return new NextResponse(`Could not load this attachment from Gmail: ${msg}`, { status: 502 });
  }
}
