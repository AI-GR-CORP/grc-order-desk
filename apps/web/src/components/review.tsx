'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { ActionResult } from '@/app/actions/result';
import { confirmCompany, mergeCompany, updateCompany } from '@/app/actions/companies';
import { activateKnowledgeProfile, saveKnowledgeProfile, startExtraction } from '@/app/actions/settings';
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

export function CompanyReviewRow({
  company,
  others,
}: {
  company: { id: string; name: string; region: string | null; city: string | null; domains: string[]; contact_count: number; thread_count: number };
  others: { id: string; name: string }[];
}) {
  const { pending, run } = useAction();
  const [name, setName] = useState(company.name);
  const [region, setRegion] = useState(company.region ?? '');
  const [city, setCity] = useState(company.city ?? '');
  const [into, setInto] = useState('');
  return (
    <li className={cx('grid gap-3 px-4 py-3 lg:grid-cols-[1.4fr_1fr_1fr_auto]', pending && 'opacity-60')}>
      <div>
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} aria-label="Company name" />
        <p className="mt-1 text-[12px] text-muted">
          {company.domains.join(', ') || 'no business domain'}; {company.contact_count} contacts, {company.thread_count} threads
        </p>
      </div>
      <input className={inputClass} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Region, e.g. Tirupur" aria-label="Region" />
      <input className={inputClass} value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" aria-label="City" />
      <div className="flex flex-wrap items-start gap-1.5">
        <Button
          size="sm"
          variant="primary"
          onClick={() =>
            run(async () => {
              const r = await updateCompany(company.id, { name, region, city });
              return r.ok ? confirmCompany(company.id) : r;
            }, 'Saved')
          }
        >
          Save
        </Button>
        <select className={cx(inputClass, 'h-7 w-40 py-0 text-[12.5px]')} value={into} onChange={(e) => setInto(e.target.value)} aria-label="Merge into">
          <option value="">Same as…</option>
          {others.filter((o) => o.id !== company.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {into && <Button size="sm" onClick={() => run(() => mergeCompany(company.id, into), 'Merged')}>Merge</Button>}
      </div>
    </li>
  );
}

export function StartExtraction({ mailboxId, threads }: { mailboxId: string; threads: number }) {
  const { pending, run } = useAction();
  return (
    <Button variant="primary" disabled={pending} onClick={() => run(() => startExtraction(mailboxId), 'Started. Rows appear as each thread is read.')}>
      Fill the tables from {threads} threads
    </Button>
  );
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
