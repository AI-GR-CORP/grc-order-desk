import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { MessageRow, ThreadRow } from '@grc/core';
import { ReplyBadge, StageChip, BulkStatusChip } from '@/components/stage';
import { ThreadActions } from '@/components/thread-actions';
import { PageHeader, Panel } from '@/components/ui';
import { cx, duration, fmtDateTime, gmailLink } from '@/lib/format';
import { fetchAll, getThumbnails } from '@/lib/data';
import { createSupabase } from '@/lib/supabase/server';

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabase();
  const { data } = await supabase.from('email_thread').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();
  const t = data as ThreadRow;

  const [messages, mailbox, company, links, companies, attachments] = await Promise.all([
    supabase.from('email_message').select('*').eq('thread_id', id).order('sent_at'),
    supabase.from('mailbox').select('email').eq('id', t.mailbox_id).maybeSingle(),
    t.company_id ? supabase.from('company').select('id, name').eq('id', t.company_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('item_thread').select('dev_item_id, bulk_order_id').eq('thread_id', id),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('company').select('id, name').is('merged_into', null).neq('approval', 'rejected').order('name').range(a, b)),
    supabase.from('attachment').select('message_id, filename, kind, size_bytes, inline').neq('kind', null),
  ]);
  const msgs = (messages.data ?? []) as MessageRow[];
  const devIds = (links.data ?? []).map((l) => l.dev_item_id).filter(Boolean) as string[];
  const bulkIds = (links.data ?? []).map((l) => l.bulk_order_id).filter(Boolean) as string[];
  const [dev, bulk, thumbs] = await Promise.all([
    devIds.length ? supabase.from('dev_item').select('id, brand, inquiry, product_code, stage, team_status').in('id', devIds) : Promise.resolve({ data: [] }),
    bulkIds.length ? supabase.from('bulk_order').select('id, brand, product_code, po_number, status').in('id', bulkIds) : Promise.resolve({ data: [] }),
    getThumbnails([id]),
  ]);
  const msgIds = new Set(msgs.map((m) => m.id));
  const files = new Map<string, string[]>();
  for (const a of (attachments.data ?? []) as { message_id: string; filename: string; inline: boolean; size_bytes: number }[]) {
    if (!msgIds.has(a.message_id) || (a.inline && (a.size_bytes ?? 0) < 15000)) continue;
    files.set(a.message_id, [...(files.get(a.message_id) ?? []), a.filename]);
  }

  return (
    <>
      <PageHeader
        title={t.subject ?? '(no subject)'}
        detail={
          <span className="flex flex-wrap items-center gap-2">
            {company.data ? <Link href={`/clients/${company.data.id}`} className="text-indigo hover:underline">{company.data.name as string}</Link> : 'Customer not identified'}
            <ReplyBadge state={t.reply_state} dueAt={t.reply_due_at} />
            {t.reply_state === 'awaiting' && t.awaiting_reply_since && <span>waiting {duration(t.awaiting_reply_since)}</span>}
            {t.handled_offline_note && t.reply_state === 'handled_offline' && <span>{t.handled_offline_note}</span>}
          </span>
        }
        actions={
          <a href={gmailLink(mailbox.data?.email as string | undefined, t.gmail_thread_id)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-md bg-indigo px-3.5 text-[13.5px] font-medium text-white hover:bg-ink">
            Reply in Gmail
          </a>
        }
      />
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:p-8">
        <div className="space-y-6">
          <Panel title="Summary">
            <div className="space-y-2 p-4 text-[13.5px]">
              <p className="max-w-3xl">{t.summary ?? 'Not summarised yet. Summaries appear once the AI has read this thread.'}</p>
              {t.next_action && <p><span className="font-medium">Next: </span>{t.next_action}</p>}
              {t.needs_review && <p className="text-[12.5px] text-mustard">The AI wasn’t sure about this thread. Check the customer and type on the right.</p>}
            </div>
          </Panel>
          <Panel title={`Emails (${msgs.length})`}>
            <ol className="divide-y divide-line-2">
              {msgs.map((m) => (
                <li key={m.id} className={cx('px-4 py-3', m.direction === 'outbound' && 'bg-teal-soft/30', m.direction === 'internal' && 'bg-ground')}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]">
                    <span>
                      <span className="font-semibold text-ink">{m.from_name ?? m.from_email}</span>{' '}
                      <span className="text-muted">{m.direction === 'inbound' ? 'customer' : m.direction === 'outbound' ? 'GRC' : 'GRC internal'}</span>
                      {m.needs_reply && m.direction === 'inbound' && <span className="ml-2 font-medium text-red">asked for a reply</span>}
                    </span>
                    <time className="text-muted">{fmtDateTime(m.sent_at)}</time>
                  </div>
                  <p className="mt-1.5 max-w-3xl whitespace-pre-wrap break-words text-[13.5px]">{m.body_clean || m.snippet}</p>
                  {files.get(m.id) && <p className="mt-1.5 text-[12px] text-muted">Attached: {files.get(m.id)!.join(', ')}</p>}
                </li>
              ))}
            </ol>
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Correct the AI">
            <div className="p-4">
              <ThreadActions threadId={t.id} category={t.category} companyId={t.company_id} companies={companies} needsReview={t.needs_review} />
            </div>
          </Panel>
          <Panel title="Items in this thread">
            <ul className="divide-y divide-line-2 text-[13px]">
              {(dev.data ?? []).map((d) => (
                <li key={d.id as string} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span><span className="font-medium">{(d.brand as string) ?? (d.product_code as string) ?? 'Item'}</span> {d.inquiry as string}</span>
                    <StageChip stage={d.stage as string} />
                  </div>
                  {d.team_status && <p className="text-[12px] text-muted">{d.team_status as string}</p>}
                </li>
              ))}
              {(bulk.data ?? []).map((b) => (
                <li key={b.id as string} className="flex items-start justify-between gap-2 px-4 py-2.5">
                  <span><span className="font-medium">Bulk {(b.product_code as string) ?? ''}</span>{b.po_number ? ` PO ${b.po_number as string}` : ''}</span>
                  <BulkStatusChip status={b.status as string} />
                </li>
              ))}
              {(dev.data ?? []).length + (bulk.data ?? []).length === 0 && <li className="px-4 py-3 text-muted">No items found in this thread.</li>}
            </ul>
          </Panel>
          {(thumbs[id] ?? []).length > 0 && (
            <Panel title="Pictures">
              <div className="grid grid-cols-3 gap-2 p-4">
                {thumbs[id]!.map((src) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt="Photo from this thread" className="aspect-square w-full rounded object-cover" /></a>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
