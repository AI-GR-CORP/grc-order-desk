'use client';
import { useEffect } from 'react';
import { markThreadRead } from '@/app/actions/inbox';

/** Opening a conversation marks it read for this person. */
export function MarkRead({ threadId }: { threadId: string }) {
  useEffect(() => {
    void markThreadRead(threadId);
  }, [threadId]);
  return null;
}
