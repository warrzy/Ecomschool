import ExcelJS from "exceljs";

/**
 * Socle XLSX commun (exceljs — génération uniquement).
 * Feuilles nommées, en-têtes en gras, filtres automatiques, largeurs
 * adaptées. Les chaînes restent des chaînes (jamais interprétées comme
 * formules — la même neutralisation que le CSV est appliquée).
 */

export interface ExportColumn {
  header: string;
  width?: number;
}
export interface ExportSheet {
  name: string;
  columns: ExportColumn[];
  rows: (string | number | Date | null | undefined)[][];
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const safeString = (s: string) =>
  FORMULA_PREFIX.test(s) ? `'${s}` : s;

function sheetName(raw: string): string {
  const s = raw.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31);
  return s || "Export";
}

export async function buildXlsxBuffer(
  sheets: ExportSheet[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ECOM-SCHOOL";
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(sheetName(s.name));
    ws.columns = s.columns.map((c) => ({
      header: c.header,
      key: undefined,
      width: c.width ?? 18,
    }));
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE4E4E7" },
    };
    head.commit();
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: s.columns.length },
    };
    for (const r of s.rows) {
      const row = ws.addRow(
        r.map((v) => (typeof v === "string" ? safeString(v) : (v ?? null))),
      );
      row.commit();
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
