'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { ActionResult } from '@/app/actions/result';
import { activateKnowledgeProfile, saveKnowledgeProfile } from '@/app/actions/settings';
import { cx } from '@/lib/format';
import { Button, inputClass } from './ui';

function useAction() {
  const [pending, start] = useTransition();
  const run = (p: () => Promise<ActionResult>, ok: string) =>
    start(async () => {
      const r = await p();
      if (r.ok) toast.success(ok);
      else toast.error(r.error);
    });
  return { pending, run };
}

export function KnowledgeEditor({
  active,
  versions,
  canEdit,
}: {
  active: string;
  versions: { version: number; active: boolean; created_at: string; preview: string }[];
  canEdit: boolean;
}) {
  const { pending, run } = useAction();
  const [text, setText] = useState(active);
  return (
    <div className="space-y-3 p-4">
      <p className="text-[13px] text-muted">
        The AI reads this before every email: who’s on the GRC team, product codes, which brands belong to which customers.
        Correct anything wrong; the next emails use the new version.
      </p>
      <textarea
        className={cx(inputClass, 'min-h-72 font-mono text-[12.5px] leading-relaxed')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        readOnly={!canEdit}
        aria-label="Knowledge profile"
      />
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={pending || text.trim() === active.trim()} onClick={() => run(() => saveKnowledgeProfile(text), 'Saved as the new version')}>
            Save new version
          </Button>
          {versions.filter((v) => !v.active).slice(0, 3).map((v) => (
            <Button key={v.version} size="sm" variant="ghost" onClick={() => run(() => activateKnowledgeProfile(v.version), `Version ${v.version} is now in use`)}>
              Use version {v.version}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
