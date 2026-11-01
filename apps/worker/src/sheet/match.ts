import { companyKey, similarity } from '@grc/core';
import type { Db } from '../db';

const codeKey = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[\s\-_./]/g, '');

interface Baseline {
  sheet_ref: string;
  company_name: string | null;
  data: Record<string, string | null>;
}
interface AiItem {
  id: string;
  company_name: string | null;
  brand: string | null;
  inquiry: string | null;
  product_code: string | null;
  colours: string | null;
  sample_collected: string | null;
  stage: string;
}

export interface MatchPair {
  sheetRef: string;
  itemId: string;
  score: number;
  sheet: Baseline['data'];
  ai: AiItem;
}

function describe(x: { brand?: string | null; inquiry?: string | null; product_code?: string | null }) {
  return [x.brand, x.inquiry, x.product_code].filter(Boolean).join(' ');
}

/** Pairs each baseline sheet row with the best AI-created item of the same company. */
export async function matchSheetRows(sql: Db): Promise<{ matched: MatchPair[]; unmatched: Baseline[]; aiOnly: AiItem[] }> {
  const base = await sql<Baseline[]>`select sheet_ref, company_name, data from sheet_baseline where kind = 'dev'`;
  const ai = await sql<AiItem[]>`
    select d.id, c.name as company_name, d.brand, d.inquiry, d.product_code, d.colours, d.sample_collected, d.stage::text
    from dev_item d left join company c on c.id = d.company_id where d.source = 'ai'`;

  const used = new Set<string>();
  const matched: MatchPair[] = [];
  const unmatched: Baseline[] = [];
  for (const b of base) {
    const ck = b.company_name ? companyKey(b.company_name) : null;
    let best: { item: AiItem; score: number } | null = null;
    for (const item of ai) {
      if (used.has(item.id)) continue;
      const sameCompany = ck && item.company_name ? companyKey(item.company_name) === ck || similarity(item.company_name, b.company_name) >= 0.5 : false;
      if (ck && !sameCompany) continue;
      let score = similarity(describe(item), describe(b.data));
      if (codeKey(item.product_code) && codeKey(item.product_code) === codeKey(b.data.product_code)) score += 0.5;
      if (!best || score > best.score) best = { item, score };
    }
    if (best && best.score >= 0.3) {
      used.add(best.item.id);
      matched.push({ sheetRef: b.sheet_ref, itemId: best.item.id, score: best.score, sheet: b.data, ai: best.item });
    } else unmatched.push(b);
  }
  return { matched, unmatched, aiOnly: ai.filter((i) => !used.has(i.id)) };
}
