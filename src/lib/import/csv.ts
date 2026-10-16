/**
 * Parseur CSV d'import (lecture seule côté données — aucune écriture).
 * - UTF-8, BOM toléré, séparateur « ; » (ou « , » / tabulation détectés).
 * - Champs entre guillemets, guillemets doublés, sauts de ligne protégés.
 * - Chaque ligne conserve son numéro de ligne physique du fichier.
 */

export interface ImportRawRow {
  /** Numéro de ligne physique dans le fichier (1 = première ligne). */
  line: number;
  cells: string[];
}

export type CsvParseResult =
  | { ok: true; rows: ImportRawRow[] }
  | { ok: false; error: "EMPTY" | "MALFORMED" | "TOO_MANY_ROWS" };

function detectDelimiter(headerLine: string): string {
  const counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of headerLine) {
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ";";
}

export function parseCsvText(text: string, maxRows: number): CsvParseResult {
  const src = text.replace(/^﻿/, "");
  if (!src.trim()) return { ok: false, error: "EMPTY" };

  const delimiter = detectDelimiter(src.split(/\r?\n/, 1)[0] ?? "");
  const rows: ImportRawRow[] = [];
  let cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  const pushRow = () => {
    cells.push(cur.trim());
    cur = "";
    if (!cells.every((c) => c === "")) rows.push({ line: rowLine, cells });
    cells = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(cur.trim());
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      pushRow();
      line++;
      rowLine = line;
    } else {
      cur += ch;
    }
  }
  if (inQuotes) return { ok: false, error: "MALFORMED" };
  if (cur !== "" || cells.length > 0) pushRow();

  if (rows.length === 0) return { ok: false, error: "EMPTY" };
  if (rows.length > maxRows) return { ok: false, error: "TOO_MANY_ROWS" };
  return { ok: true, rows };
}
