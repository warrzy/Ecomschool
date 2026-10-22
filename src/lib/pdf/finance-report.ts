import type PDFKit from "pdfkit";
import type { ReportSheet } from "@/lib/services/finance/reports";

/**
 * Renderer PDF générique des rapports financiers (F3-D).
 * En-tête : établissement, titre, période/filtres, date de génération.
 * Tables paginées A4 paysage, ligne de total en gras, notes de bas.
 * Pied de page : « page X / N » ajouté après coup via bufferedPages.
 */

export type FinanceReportSnapshot = {
  schoolName: string;
  title: string;
  meta: string[];
  notes: string[];
  sheets: ReportSheet[];
};

const fmtCell = (v: string | number | null) =>
  v == null
    ? ""
    : typeof v === "number"
      ? `${v.toLocaleString("fr-FR")} FCFA`
      : v;

export function renderFinanceReport(
  doc: PDFKit.PDFDocument,
  s: FinanceReportSnapshot,
) {
  const M = 36;
  const W = doc.page.width;
  const H = doc.page.height;
  let y = M;

  // ---- En-tête ----
  doc.font("Helvetica-Bold").fontSize(15).text(s.schoolName, M, y);
  doc.font("Helvetica").fontSize(9).fillColor("#555")
    .text(`Généré le ${new Date().toLocaleDateString("fr-FR")} à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`, M, y + 18);
  doc.fillColor("#000");
  doc.font("Helvetica-Bold").fontSize(13).text(s.title.toUpperCase(), M, y + 34);
  y += 52;
  doc.font("Helvetica").fontSize(8).fillColor("#444");
  for (const line of s.meta) {
    doc.text(line, M, y);
    y += 11;
  }
  doc.fillColor("#000");
  y += 8;

  const ensureSpace = (needed: number) => {
    if (y + needed > H - 60) {
      doc.addPage();
      y = M;
    }
  };

  // ---- Feuilles / tables ----
  for (const sheet of s.sheets) {
    ensureSpace(60);
    doc.font("Helvetica-Bold").fontSize(11).text(sheet.name, M, y);
    y += 16;

    const nCols = sheet.headers.length;
    const tableW = W - 2 * M;
    // Répartition simple : colonne « libellé/catégorie/opération » élargie.
    const wideIdx = sheet.headers.findIndex((h) =>
      ["libelle", "categorie", "indicateur", "nom", "mode", "recu"].includes(h),
    );
    const baseW = tableW / nCols;
    const widths = sheet.headers.map((_, i) =>
      i === wideIdx ? baseW * 1.8 : baseW * (nCols - 0.8) / nCols,
    );
    const xs = widths.reduce<number[]>((acc, w, i) => {
      acc.push(i === 0 ? M : acc[i - 1] + widths[i - 1]);
      return acc;
    }, []);

    // En-tête de table
    ensureSpace(20);
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#333");
    sheet.headers.forEach((h, i) => {
      doc.text(h, xs[i] + 2, y, { width: widths[i] - 4 });
    });
    doc.fillColor("#000");
    y += 12;
    doc.moveTo(M, y).lineTo(W - M, y).strokeColor("#999").lineWidth(0.6).stroke();
    y += 5;

    // Lignes — saut de page automatique avec répétition de l'en-tête.
    doc.font("Helvetica").fontSize(7.5);
    for (const row of sheet.rows) {
      if (y + 12 > H - 60) {
        doc.addPage();
        y = M;
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#333");
        sheet.headers.forEach((h, i) => {
          doc.text(h, xs[i] + 2, y, { width: widths[i] - 4 });
        });
        doc.fillColor("#000").font("Helvetica").fontSize(7.5);
        y += 12;
        doc.moveTo(M, y).lineTo(W - M, y).strokeColor("#999").lineWidth(0.6).stroke();
        y += 5;
      }
      row.forEach((v, i) => {
        const isAmount = /xof|montant|part/i.test(sheet.headers[i]);
        doc.text(fmtCell(v), xs[i] + 2, y, {
          width: widths[i] - 4,
          align: isAmount ? "right" : "left",
        });
      });
      y += 11;
    }

    // Ligne de total
    if (sheet.totals) {
      y += 4;
      doc.moveTo(M, y).lineTo(W - M, y).strokeColor("#999").lineWidth(0.6).stroke();
      y += 6;
      doc.font("Helvetica-Bold").fontSize(8);
      sheet.totals.forEach((v, i) => {
        if (i >= xs.length) return;
        const isAmount = /xof|montant|part/i.test(sheet.headers[i]);
        doc.text(fmtCell(v), xs[i] + 2, y, {
          width: widths[i] - 4,
          align: isAmount ? "right" : "left",
        });
      });
      doc.font("Helvetica");
      y += 14;
    }
    y += 14;
  }

  // ---- Notes ----
  if (s.notes.length) {
    ensureSpace(30);
    doc.font("Helvetica-Oblique").fontSize(7.5).fillColor("#555");
    for (const n of s.notes) {
      ensureSpace(11);
      doc.text(`— ${n}`, M, y, { width: W - 2 * M });
      y += doc.heightOfString(`— ${n}`, { width: W - 2 * M }) + 3;
    }
    doc.fillColor("#000").font("Helvetica");
  }

  // ---- Pied de page : numérotation ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(7).fillColor("#888").text(
      `Page ${i + 1} / ${range.count} — document généré par ECOM-SCHOOL`,
      M,
      H - 30,
      { width: W - 2 * M, align: "center" },
    );
    doc.fillColor("#000");
  }
}
