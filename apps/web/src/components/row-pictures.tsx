'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { addRowPicture, hideRowPicture } from '@/app/actions/pictures';
import { picSourceLabel, type RowPic, type RowTarget } from '@/lib/pictures';
import { Button } from './ui';

/** Resizes in the browser (WebP, or JPEG where WebP can't be written) so uploads stay small. */
async function shrink(file: Blob, max: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * scale));
  const height = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, width, height);
  const encode = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
  let blob = await encode('image/webp');
  if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg');
  if (!blob) throw new Error("Couldn't read that picture.");
  return { blob, width, height };
}

export function RowPictures({ pictures, target }: { pictures: RowPic[]; target: RowTarget | null }) {
  const [busy, start] = useTransition();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const shown = pictures.filter((p) => !p.id || !gone.has(p.id));

  const upload = (file: File | Blob) =>
    start(async () => {
      if (!target) return;
      try {
        const full = await shrink(file, 1600, 0.82);
        const thumb = await shrink(file, 480, 0.72);
        const form = new FormData();
        form.set('kind', target.kind);
        form.set('id', target.id);
        form.set('full', full.blob);
        form.set('thumb', thumb.blob);
        form.set('width', String(full.width));
        form.set('height', String(full.height));
        const r = await addRowPicture(form);
        if (!r.ok) return void toast.error(r.error);
        toast.success('Picture added');
      } catch {
        toast.error("Couldn't read that picture. Try a screenshot, JPG or PNG.");
      }
    });

  // Paste a screenshot anywhere in the panel (not while typing in a field).
  useEffect(() => {
    if (!target) return;
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      upload(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.kind, target?.id]);

  const remove = (p: RowPic) =>
    start(async () => {
      if (!p.id) return;
      const r = await hideRowPicture(p.id);
      if (!r.ok) return void toast.error(r.error);
      setGone((s) => new Set(s).add(p.id!));
      toast.success('Picture removed');
    });

  return (
    <section aria-busy={busy}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-muted">
          Pictures{shown.length ? ` (${shown.length})` : ''}
        </h3>
        {target && (
          <>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
              <span aria-hidden className="text-[15px] leading-none">+</span> Add picture
            </Button>
            <input
              ref={input}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-label="Add a picture"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>
      {shown.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {shown.map((p, i) => (
            <figure key={p.id ?? `${p.thumb}-${i}`} className="group relative m-0">
              <a href={p.full} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumb} alt={picSourceLabel(p)} className="aspect-square w-full object-contain" />
              </a>
              <figcaption className="mt-1 truncate text-[11.5px] text-muted" title={picSourceLabel(p)}>
                {picSourceLabel(p)}
              </figcaption>
              {p.id && (
                <button
                  type="button"
                  onClick={() => remove(p)}
                  disabled={busy}
                  aria-label="Remove this picture"
                  title="Remove this picture"
                  className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-surface/95 text-[15px] leading-none text-ink-2 shadow-sm ring-1 ring-line hover:text-red focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                >
                  ×
                </button>
              )}
            </figure>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-muted">No pictures yet.</p>
      )}
      {target && <p className="mt-2 text-[12.5px] text-faint">Tip: copy a screenshot and press ⌘V here to add it.</p>}
    </section>
  );
}
