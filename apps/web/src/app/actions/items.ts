'use server';
import { revalidatePath } from 'next/cache';
import { BULK_EDITABLE_FIELDS, BULK_STATUS_KEYS, DEV_EDITABLE_FIELDS, DEV_STAGE_KEYS, normalizeIsoDate } from '@grc/core';
import { assertUser } from '@/lib/auth';
import { createSupabase } from '@/lib/supabase/server';
import { run, type ActionResult } from './result';

const DEV_DATES = new Set(['enquiry_date', 'sample_dispatch_date', 'edd']);

function parseDayMonthYear(v: string): string | null {
  const m = v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (!m) return normalizeIsoDate(v);
  const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Inline edit of one development cell. The field is locked so the AI never overwrites it. */
export async function updateDevField(id: string, field: string, raw: string | null): Promise<ActionResult> {
  return run(async () => {
    const user = await assertUser();
    if (!DEV_EDITABLE_FIELDS.has(field)) throw new Error('That column can’t be edited.');
    let value: string | null = raw?.trim() ? raw.trim() : null;
    if (value && DEV_DATES.has(field)) {
      value = parseDayMonthYear(value);
      if (!value) throw new Error('Use a date like 26/10/2026.');
    }
    if (field === 'stage' && !DEV_STAGE_KEYS.includes(value as never)) throw new Error('Pick a stage from the list.');

    const supabase = await createSupabase();
    const { data: cur, error } = await supabase.from('dev_item').select(`${field}, locked_fields, source`).eq('id', id).single();
    if (error || !cur) throw new Error('Row not found.');
    const row = cur as unknown as Record<string, unknown> & { locked_fields: string[]; source: string };
    const locked = [...new Set([...(row.locked_fields ?? []), field])];
    const upd = await supabase.from('dev_item').update({ [field]: value, locked_fields: locked }).eq('id', id);
    if (upd.error) throw new Error(upd.error.message);

    const before = row[field] === null || row[field] === undefined ? null : String(row[field]);
    if (row.source === 'ai' && before !== value) {
      await supabase.from('correction').insert({ entity: 'dev_item', entity_id: id, field, ai_value: before, human_value: value, corrected_by: user.id });
    }
    revalidatePath('/orders');
  });
}

export async function unlockDevField(id: string, field: string): Promise<ActionResult> {
  return run(async () => {
    await assertUser();
    const supabase = await createSupabase();
    const { data } = await supabase.from('dev_item').select('locked_fields').eq('id', id).single();
    const locked = ((data?.locked_fields as string[]) ?? []).filter((f) => f !== field);
    await supabase.from('dev_item').update({ locked_fields: locked }).eq('id', id);
    revalidatePath('/orders');
  });
}

export async function updateBulkField(id: string, field: string, raw: string | null): Promise<ActionResult> {
  return run(async () => {
    const user = await assertUser();
    if (!BULK_EDITABLE_FIELDS.has(field)) throw new Error('That column can’t be edited.');
    let value: string | number | null = raw?.trim() ? raw.trim() : null;
    if (field === 'qty_mtrs' && value !== null) {
      const n = Number(String(value).replace(/,/g, ''));
      if (!Number.isFinite(n)) throw new Error('Quantity must be a number of metres.');
      value = n;
    }
    if (field === 'status' && !BULK_STATUS_KEYS.includes(value as never)) throw new Error('Pick a status from the list.');
    const supabase = await createSupabase();
    const { data: cur } = await supabase.from('bulk_order').select(`${field}, locked_fields, source`).eq('id', id).single();
    const row = (cur ?? {}) as Record<string, unknown> & { locked_fields?: string[]; source?: string };
    const locked = [...new Set([...(row.locked_fields ?? []), field])];
    const upd = await supabase.from('bulk_order').update({ [field]: value, locked_fields: locked }).eq('id', id);
    if (upd.error) throw new Error(upd.error.message);
    if (row.source === 'ai') {
      await supabase.from('correction').insert({
        entity: 'bulk_order', entity_id: id, field,
        ai_value: row[field] == null ? null : String(row[field]), human_value: value == null ? null : String(value), corrected_by: user.id,
      });
    }
    revalidatePath('/orders');
  });
}

/** Sets one checklist cell ("PI Sent: 20/01/2025"). Empty value clears it. */
export async function setBulkStage(orderId: string, stageKey: string, raw: string | null): Promise<ActionResult> {
  return run(async () => {
    await assertUser();
    const supabase = await createSupabase();
    const value = raw?.trim() ?? '';
    if (!value) {
      const del = await supabase.from('bulk_order_stage').update({ value: null, done_on: null, locked: true, source: 'manual' })
        .eq('bulk_order_id', orderId).eq('stage_key', stageKey);
      if (del.error) throw new Error(del.error.message);
    } else {
      const up = await supabase.from('bulk_order_stage').upsert(
        { bulk_order_id: orderId, stage_key: stageKey, value, done_on: parseDayMonthYear(value), locked: true, source: 'manual' },
        { onConflict: 'bulk_order_id,stage_key' },
      );
      if (up.error) throw new Error(up.error.message);
      await supabase.from('bulk_order').update({ current_stage: stageKey }).eq('id', orderId);
    }
    revalidatePath('/orders');
  });
}

/** A row someone adds by hand (an inquiry that came by phone or WhatsApp). */
export async function addDevItem(companyId: string | null, inquiry: string, brand: string | null): Promise<ActionResult> {
  return run(async () => {
    await assertUser();
    if (!inquiry.trim()) throw new Error('Describe the inquiry.');
    const supabase = await createSupabase();
    const { error } = await supabase.from('dev_item').insert({
      company_id: companyId, inquiry: inquiry.trim(), brand: brand?.trim() || null, source: 'manual',
      enquiry_date: new Date().toISOString().slice(0, 10), last_activity_at: new Date().toISOString(),
      locked_fields: ['inquiry', 'brand'],
    });
    if (error) throw new Error(error.message);
    revalidatePath('/orders');
  });
}
