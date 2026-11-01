import type { Db } from '../db';

/** True when the thread belongs to a client an owner has approved. */
export async function isThreadClientApproved(sql: Db, threadId: string): Promise<boolean> {
  const [row] = await sql<{ ok: boolean }[]>`
    select (c.approval = 'approved') as ok
    from email_thread t join company c on c.id = t.company_id
    where t.id = ${threadId}`;
  return row?.ok ?? false;
}
