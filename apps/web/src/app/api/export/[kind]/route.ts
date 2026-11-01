import ExcelJS from 'exceljs';
import { NextResponse, type NextRequest } from 'next/server';
import { columnLabel, DEV_COLUMNS, devStageLabel, bulkStatusLabel, type BulkOrderView, type BulkStageDefRow, type DevItemView } from '@grc/core';
import { getAppUser } from '@/lib/auth';
import { fetchAll, getSettings } from '@/lib/data';
import { createSupabase } from '@/lib/supabase/server';

/** Excel export in the same column layout as the dashboard (and GRC's old sheet). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getAppUser();
  if (!user) return new NextResponse('Sign in first', { status: 401 });
  const { kind } = await params;
  const supabase = await createSupabase();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GRC Order Desk';
  const headerStyle = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D2B4F' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };

  if (kind === 'development') {
    const settings = await getSettings(supabase);
    const rows = await fetchAll<DevItemView>((a, b) => supabase.from('v_dev_items').select('*').order('company_name').order('enquiry_date', { ascending: false }).range(a, b));
    const ws = wb.addWorksheet('Development');
    ws.columns = [
      { header: 'Company', key: 'company_name', width: 28 },
      { header: 'Region', key: 'company_region', width: 14 },
      { header: 'City', key: 'company_city', width: 14 },
      ...DEV_COLUMNS.map((c) => ({ header: columnLabel(c, settings.column_labels), key: c.key, width: Math.round(c.width / 7) })),
      { header: 'Summary', key: 'summary', width: 60 },
    ];
    for (const r of rows) ws.addRow({ ...r, stage: devStageLabel(r.stage) });
    headerStyle(ws);
  } else if (kind === 'bulk') {
    const { data: defs } = await supabase.from('bulk_stage_def').select('*').order('sort_order');
    const stages = (defs ?? []) as BulkStageDefRow[];
    const rows = await fetchAll<BulkOrderView>((a, b) => supabase.from('v_bulk_orders').select('*').order('company_name').range(a, b));
    const ws = wb.addWorksheet('Bulk orders');
    ws.columns = [
      { header: 'Company', key: 'company', width: 26 },
      { header: 'Brand', key: 'brand', width: 16 },
      { header: 'Product code', key: 'code', width: 16 },
      { header: 'Qty (mtrs)', key: 'qty', width: 12 },
      { header: 'Status', key: 'status', width: 14 },
      ...stages.map((s) => ({ header: s.label, key: s.key, width: 18 })),
      { header: 'Next action', key: 'next_action', width: 40 },
      { header: 'Owner remark', key: 'owner_remark', width: 40 },
    ];
    for (const r of rows) {
      const row: Record<string, unknown> = {
        company: r.company_name, brand: r.brand, code: r.product_code, qty: r.qty_mtrs, status: bulkStatusLabel(r.status),
        next_action: r.next_action, owner_remark: r.owner_remark,
      };
      for (const s of stages) row[s.key] = r.stages[s.key]?.value ?? '';
      ws.addRow(row);
    }
    headerStyle(ws);
  } else {
    return new NextResponse('Unknown export', { status: 404 });
  }

  const buf = await wb.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="grc-${kind}-${date}.xlsx"`,
      'cache-control': 'no-store',
    },
  });
}
