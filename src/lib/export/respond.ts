import { NextResponse } from "next/server";
import { toCsv } from "@/lib/export/csv";
import { buildXlsxBuffer } from "@/lib/export/xlsx";

/**
 * Réponse de téléchargement mutualisée pour toutes les routes d'export.
 * CSV = première feuille uniquement ; XLSX = toutes les feuilles.
 */

export type Cell = string | number | null | undefined;

export interface ExportSheetData {
  name: string;
  headers: readonly string[];
  widths?: number[];
  rows: Cell[][];
}

export async function exportFile(opts: {
  format: "csv" | "xlsx";
  /** Nom de fichier sans extension (un horodatage est ajouté). */
  filename: string;
  sheets: ExportSheetData[];
  /** Marqueur ajouté en fin de première feuille quand le plafond est atteint. */
  truncated?: boolean;
}): Promise<NextResponse> {
  const stamp = new Date().toISOString().slice(0, 10);
  const sheets = opts.sheets.map((s) => ({ ...s, rows: [...s.rows] }));
  if (opts.truncated) {
    sheets[0].rows.push([
      "Export tronqué — affinez les filtres (plafond atteint).",
    ]);
  }

  if (opts.format === "xlsx") {
    const buf = await buildXlsxBuffer(
      sheets.map((s) => ({
        name: s.name,
        columns: s.headers.map((h, i) => ({
          header: h,
          width: s.widths?.[i] ?? 18,
        })),
        rows: s.rows,
      })),
    );
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${opts.filename}-${stamp}.xlsx"`,
      },
    });
  }

  const first = sheets[0];
  return new NextResponse(
    toCsv([...first.headers], first.rows),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${opts.filename}-${stamp}.csv"`,
      },
    },
  );
}
