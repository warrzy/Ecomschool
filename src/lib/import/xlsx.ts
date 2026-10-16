/**
 * Lecture XLSX d'import via ExcelJS (dépendance déjà présente pour les exports).
 * Sécurité :
 * - une seule feuille (la première) est lue ;
 * - les cellules contenant des formules sont rejetées (pas de code embarqué) ;
 * - les types complexes (richText, hyperlien, date) sont réduits en texte ;
 * - le nombre de lignes est plafonné.
 */
import ExcelJS from "exceljs";
import type { ImportRawRow } from "./csv";

export type XlsxReadResult =
  | { ok: true; rows: ImportRawRow[] }
  | { ok: false; error: "EMPTY" | "MALFORMED" | "TOO_MANY_ROWS" | "FORMULA" };

type CellValue = ExcelJS.CellValue;

function cellToText(v: CellValue): string | { formula: true } | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) return { formula: true };
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((t) => t.text ?? "").join("");
    }
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("error" in v) return null;
    if ("result" in v) return cellToText(v.result as CellValue);
    return null;
  }
  return null;
}

export async function readXlsxRows(
  buffer: ArrayBuffer,
  maxRows: number,
): Promise<XlsxReadResult> {
  const wb = new ExcelJS.Workbook();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buffer as any);
  } catch {
    return { ok: false, error: "MALFORMED" };
  }

  const ws = wb.worksheets[0];
  if (!ws) return { ok: false, error: "EMPTY" };

  const rows: ImportRawRow[] = [];
  let formulaLine = false;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (formulaLine || rows.length > maxRows) return;
    const cells: string[] = [];
    // row.values est 1-indexé ; on compacte en sautant les trous du début.
    const values = row.values as CellValue[];
    for (let i = 1; i < values.length; i++) {
      const t = cellToText(values[i]);
      if (t !== null && typeof t === "object") {
        formulaLine = true;
        return;
      }
      cells.push(typeof t === "string" ? t.trim() : "");
    }
    // Trailing empty cells dropped; fully empty lines skipped.
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    if (cells.length > 0) rows.push({ line: rowNumber, cells });
  });

  if (formulaLine) return { ok: false, error: "FORMULA" };
  if (rows.length === 0) return { ok: false, error: "EMPTY" };
  if (rows.length > maxRows) return { ok: false, error: "TOO_MANY_ROWS" };
  return { ok: true, rows };
}
