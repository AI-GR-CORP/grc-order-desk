'use client';
import { useState } from 'react';

export interface FileRef {
  id: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
}

const size = (n: number | null) => (!n ? '' : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

function kindOf(f: FileRef): { label: string; cls: string } {
  const t = (f.mime_type ?? '').toLowerCase();
  const n = (f.filename ?? '').toLowerCase();
  if (t === 'application/pdf' || n.endsWith('.pdf')) return { label: 'PDF', cls: 'bg-red-soft text-red' };
  if (t.startsWith('image/')) return { label: 'IMG', cls: 'bg-indigo-soft text-indigo' };
  if (/sheet|excel|csv/.test(t) || /\.(xlsx?|csv)$/.test(n)) return { label: 'XLS', cls: 'bg-green-soft text-green' };
  if (/word|document/.test(t) || /\.docx?$/.test(n)) return { label: 'DOC', cls: 'bg-indigo-soft text-indigo' };
  return { label: 'FILE', cls: 'bg-slate-soft text-muted' };
}

/** Attachments of one email: images and PDFs open in a new tab, everything else downloads. */
export function Attachments({ files }: { files: FileRef[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="mt-2.5 flex flex-wrap gap-2" aria-label="Attachments">
      {files.map((f) => {
        const k = kindOf(f);
        return (
          <li key={f.id}>
            <a
              href={`/api/attachments/${f.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-[280px] items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] hover:border-indigo hover:bg-indigo-soft/40"
              title={`Open ${f.filename ?? 'attachment'}`}
            >
              <span className={`rounded px-1 py-[1px] text-[10.5px] font-bold ${k.cls}`}>{k.label}</span>
              <span className="truncate font-medium text-ink-2">{f.filename ?? 'attachment'}</span>
              <span className="shrink-0 text-[12px] text-muted">{size(f.size_bytes)}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** The email exactly as it was sent (formatting, tables, pictures), loaded from Gmail on demand. */
export function OriginalEmail({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button type="button" className="text-[13px] font-medium text-indigo hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Hide original email' : 'Show original email'}
      </button>
      {open && (
        <div className="mt-2 overflow-hidden rounded-lg border border-line">
          <iframe
            title="Original email"
            src={`/api/messages/${messageId}/original`}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            className="block h-[560px] w-full bg-white"
          />
          <a href={`/api/messages/${messageId}/original`} target="_blank" rel="noreferrer" className="block border-t border-line px-3 py-1.5 text-[12.5px] text-indigo hover:underline">
            Open in a new tab
          </a>
        </div>
      )}
    </div>
  );
}
