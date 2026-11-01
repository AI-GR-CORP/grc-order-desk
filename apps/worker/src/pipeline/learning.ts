import { buildLearningContext, type CorrectionExample, type SheetExample } from '@grc/core/ai';
import type { Db } from '../db';

let cache: { at: number; value: string } | null = null;

/**
 * Sheet-style examples + recent human corrections, injected into every extraction prompt.
 * This is how the system keeps "learning" without fine-tuning: fix a cell in the dashboard and
 * the next emails are read with that fix in mind. Cached for 5 minutes.
 */
export async function getLearningContext(sql: Db): Promise<string> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.value;

  // Rows with the richest notes, spread across stages, from GRC's own spreadsheet.
  const sheetRows = await sql<{ company_name: string | null; data: Record<string, string | null> }[]>`
    select company_name, data from (
      select company_name, data,
             row_number() over (partition by data->>'stage' order by length(coalesce(data->>'team_status','')) desc) as rn
      from sheet_baseline
      where kind = 'dev' and coalesce(data->>'team_status', data->>'next_action') is not null
    ) x where rn <= 3
    limit 20`;
  const sheet: SheetExample[] = sheetRows.map((r) => ({
    company: r.company_name,
    brand: r.data.brand,
    inquiry: r.data.inquiry,
    product_code: r.data.product_code,
    team_status: r.data.team_status,
    next_action: r.data.next_action,
    stage: r.data.stage,
  }));

  const corrections = await sql<CorrectionExample[]>`
    select c.field,
           case when c.field = 'company_id' then (select name from company where id::text = c.ai_value) else c.ai_value end as ai_value,
           case when c.field = 'company_id' then (select name from company where id::text = c.human_value) else c.human_value end as human_value,
           nullif(trim(concat_ws(' ', d.brand, d.product_code, b.product_code, t.subject)), '') as context
    from correction c
    left join dev_item d     on c.entity = 'dev_item'     and d.id = c.entity_id
    left join bulk_order b   on c.entity = 'bulk_order'   and b.id = c.entity_id
    left join email_thread t on c.entity = 'email_thread' and t.id = c.entity_id
    where c.field not in ('owner_remark', 'locked_fields')
    order by c.created_at desc
    limit 40`;

  const value = buildLearningContext(sheet, corrections);
  cache = { at: Date.now(), value };
  return value;
}
