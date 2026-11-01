import Link from 'next/link';
import type { MailboxStatusRow } from '@grc/core';
import { ago, cx } from '@/lib/format';

/** One line under the logo: is the mailbox connected and recently synced? */
export function SyncStatus({ mailboxes }: { mailboxes: MailboxStatusRow[] }) {
  const mb = mailboxes[0];
  let tone = 'text-muted';
  let dot = 'bg-slate';
  let text: string;
  if (!mb) {
    text = 'Gmail not connected';
    dot = 'bg-mustard';
  } else if (mb.status === 'needs_reconnect') {
    text = 'Gmail disconnected';
    dot = 'bg-red';
    tone = 'font-bold text-red';
  } else if (mb.status === 'paused') {
    text = 'Sync paused';
    dot = 'bg-mustard';
  } else if (mb.status === 'pending' || mb.status === 'backfilling') {
    text = 'Importing mail…';
    dot = 'bg-mustard';
  } else {
    const stale = !mb.last_synced_at || Date.now() - new Date(mb.last_synced_at).getTime() > 15 * 60_000;
    text = stale ? `Last checked ${ago(mb.last_synced_at)}` : `Checked ${ago(mb.last_synced_at)}`;
    dot = stale ? 'bg-mustard' : 'bg-teal';
  }
  return (
    <Link href="/settings" className={cx('flex items-center gap-2 text-[12.5px]', tone)} title={text}>
      <span className={cx('size-2 shrink-0 rounded-full', dot)} aria-hidden />
      <span className="sync-text truncate">{text}</span>
    </Link>
  );
}
