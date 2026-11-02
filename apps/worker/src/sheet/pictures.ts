import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';

/**
 * Pictures placed in GRC's workbook, with the exact cell each one sits in. A picture belongs to
 * the row its top-left corner is in, which is how the team lays the sheet out (one product per row).
 */
export interface SheetPicture {
  tab: string;
  row: number;
  col: number;
  cell: string;
  /** "NEW INQUIRY!14": the same key the sheet importer uses for that row. */
  sheetRef: string;
  data: Buffer;
  extension: string;
  sha256: string;
}

function colLetter(n: number): string {
  let s = '';
  for (let c = n; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
}

export async function readSheetPictures(path: string): Promise<SheetPicture[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const out: SheetPicture[] = [];
  for (const ws of wb.worksheets) {
    const tab = ws.name.trim();
    for (const im of ws.getImages()) {
      const tl = im.range.tl as { nativeRow?: number; nativeCol?: number; row?: number; col?: number };
      const row = Math.floor(tl.nativeRow ?? tl.row ?? 0) + 1;
      const col = Math.floor(tl.nativeCol ?? tl.col ?? 0) + 1;
      const media = wb.getImage(Number(im.imageId)) as { buffer?: ArrayBuffer | Buffer; extension?: string } | undefined;
      if (!media?.buffer) continue;
      const data = Buffer.isBuffer(media.buffer) ? media.buffer : Buffer.from(media.buffer);
      out.push({
        tab,
        row,
        col,
        cell: `${colLetter(col)}${row}`,
        sheetRef: `${tab}!${row}`,
        data,
        extension: media.extension ?? 'png',
        sha256: createHash('sha256').update(data).digest('hex'),
      });
    }
  }
  // Left to right within a row (inquiry artwork before the "picture" column), top to bottom.
  return out.sort((a, b) => a.tab.localeCompare(b.tab) || a.row - b.row || a.col - b.col);
}

/** Rows that hold a picture, per tab: passed to the sheet parser so picture-only rows are kept. */
export function pictureRows(pictures: readonly SheetPicture[]): Map<string, Set<number>> {
  const m = new Map<string, Set<number>>();
  for (const p of pictures) {
    if (!m.has(p.tab)) m.set(p.tab, new Set());
    m.get(p.tab)!.add(p.row);
  }
  return m;
}
