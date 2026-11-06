/**
 * H5 — Procès-verbal de délibération (PDF).
 *
 * Document figé : numéro PV-YYYY-NNNNN attribué à la préparation,
 * décisions issues des snapshots — une modification ultérieure des
 * moyennes ne change pas le PV.
 * Filigrane « TEST » hors production commerciale (convention G4).
 */
import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";
import { loadSchoolLogo } from "./report-card";
import { isTestEnvironment } from "@/lib/services/administrative-docs";
import { SCOPE_LABELS, SESSION_STATUS_LABELS } from "@/lib/services/deliberations";
import type { getSessionForPv } from "@/lib/services/deliberations";

type PvData = NonNullable<Awaited<ReturnType<typeof getSessionForPv>>>;

const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("fr-FR") : "—";
const fmtScore = (n: number | null | undefined) =>
  n == null ? "—" : n.toFixed(2).replace(".", ",");

function watermark(doc: PDFKit.PDFDocument, text: string) {
  const { width, height } = doc.page;
  doc.save();
  doc
    .rotate(-32, { origin: [width / 2, height / 2] })
    .font("Helvetica-Bold")
    .fontSize(64)
    .fillColor("#c0392b")
    .opacity(0.12)
    .text(text, 0, height / 2 - 40, { align: "center", width });
  doc.opacity(1).fillColor("#000");
  doc.restore();
}

export async function buildDeliberationPvPdf(data: PvData): Promise<Buffer> {
  const { session, school, stats } = data;
  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
    info: { Title: `PV délibération ${session.number}` },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );

  const W = doc.page.width;
  const M = 40;
  if (isTestEnvironment()) watermark(doc, "TEST");

  // En-tête établissement
  const logo = school ? loadSchoolLogo(school.logoUrl) : null;
  let y = M;
  if (logo) {
    try {
      doc.image(logo, M, y, { fit: [50, 50] });
    } catch {
      /* logo illisible — ignoré */
    }
  }
  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(school?.name ?? "Établissement", M + (logo ? 62 : 0), y + 4, {
      width: W - 2 * M - (logo ? 62 : 0),
    });
  const contact = [school?.address, school?.city, school?.phone]
    .filter(Boolean)
    .join(" · ");
  if (contact) {
    doc.font("Helvetica").fontSize(9).text(contact, M + (logo ? 62 : 0), y + 24);
  }
  y += 62;
  doc.moveTo(M, y).lineTo(W - M, y).strokeColor("#999").stroke();
  y += 14;

  // Titre + métadonnées
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(`PROCÈS-VERBAL DE DÉLIBÉRATION — ${session.number}`, M, y, {
      width: W - 2 * M,
      align: "center",
    });
  y += 26;
  doc.font("Helvetica").fontSize(10);
  const meta: [string, string][] = [
    ["Type", SCOPE_LABELS[session.scope]],
    ["Année scolaire", session.academicYear.name],
    ["Classe", `${session.classroom.name} (${session.classroom.level.name})`],
    [
      "Période",
      session.academicPeriod?.name ?? "— (délibération annuelle)",
    ],
    ["Professeur principal", session.classroom.headTeacher
      ? `${session.classroom.headTeacher.firstName} ${session.classroom.headTeacher.lastName}`
      : "—"],
    ["Statut", SESSION_STATUS_LABELS[session.status]],
    ["Préparée le", fmtDate(session.preparedAt)],
    ["Validée le", fmtDate(session.validatedAt)],
    ["Publiée le", fmtDate(session.publishedAt)],
  ];
  for (const [k, v] of meta) {
    doc.font("Helvetica-Bold").text(`${k} : `, M, y, { continued: true });
    doc.font("Helvetica").text(v);
    y = doc.y;
  }
  if (session.note) {
    doc.font("Helvetica-Oblique").fontSize(9).text(`Note : ${session.note}`, M, y + 4);
    y = doc.y;
  }
  y += 10;

  // Tableau des décisions
  const cols = [
    { h: "N°", w: 24 },
    { h: "Matricule", w: 62 },
    { h: "Élève", w: 130 },
    { h: "Moyenne", w: 48 },
    { h: "Rang", w: 32 },
    { h: "Proposition", w: 108 },
    { h: "Décision retenue", w: 111 },
  ];
  const rowH = 16;
  const drawHeader = () => {
    doc.font("Helvetica-Bold").fontSize(8);
    let x = M;
    for (const c of cols) {
      doc.rect(x, y, c.w, rowH).fillAndStroke("#eee", "#999");
      doc.fillColor("#000").text(c.h, x + 3, y + 4, { width: c.w - 6 });
      x += c.w;
    }
    y += rowH;
    doc.font("Helvetica").fontSize(8);
  };
  drawHeader();
  let i = 0;
  for (const d of session.decisions) {
    if (y + rowH > doc.page.height - 70) {
      doc.addPage();
      if (isTestEnvironment()) watermark(doc, "TEST");
      y = M;
      drawHeader();
    }
    i++;
    let x = M;
    const cells = [
      String(i),
      d.student.matricule,
      `${d.student.lastName} ${d.student.firstName}`,
      fmtScore(d.averageSnapshot),
      d.rankSnapshot != null ? String(d.rankSnapshot) : "—",
      d.proposedLabel ?? "—",
      d.finalLabel ?? "(sans décision)",
    ];
    for (let c = 0; c < cols.length; c++) {
      doc.rect(x, y, cols[c].w, rowH).stroke("#ccc");
      const bold = c === 6 && d.status === "ADJUSTED";
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .text(cells[c], x + 3, y + 4, { width: cols[c].w - 6, ellipsis: true });
      x += cols[c].w;
    }
    y += rowH;
    if (d.adjustmentReason) {
      doc
        .font("Helvetica-Oblique")
        .fontSize(7)
        .fillColor("#555")
        .text(`   Ajustement motivé : ${d.adjustmentReason}`, M + 24, y + 1, {
          width: W - 2 * M - 24,
        });
      doc.fillColor("#000").font("Helvetica").fontSize(8);
      y = doc.y + 2;
    }
  }

  // Synthèse
  if (y + 90 > doc.page.height - 60) {
    doc.addPage();
    if (isTestEnvironment()) watermark(doc, "TEST");
    y = M;
  }
  y += 14;
  doc.font("Helvetica-Bold").fontSize(11).text("Synthèse", M, y);
  y = doc.y + 4;
  doc.font("Helvetica").fontSize(10);
  doc.text(
    `Effectif : ${stats.enrolled} — Élèves classés : ${stats.ranked} — ` +
      `Moyenne de classe : ${fmtScore(stats.classAverage)}`,
    M,
    y,
  );
  y = doc.y + 6;
  if (stats.byDecision.length) {
    for (const [label, count] of stats.byDecision) {
      doc.text(`${label} : ${count}`, M + 12, y);
      y = doc.y;
    }
  }
  if (stats.undecided) {
    doc
      .font("Helvetica-Oblique")
      .text(`Sans décision retenue : ${stats.undecided}`, M + 12, y);
    y = doc.y;
  }
  if (session.unlockReason) {
    doc
      .font("Helvetica-Oblique")
      .fontSize(9)
      .text(`Déverrouillage : ${session.unlockReason}`, M, y + 6);
    y = doc.y;
  }
  if (session.depublishReason) {
    doc
      .font("Helvetica-Oblique")
      .fontSize(9)
      .text(`Dépublication : ${session.depublishReason}`, M, y + 6);
    y = doc.y;
  }

  // Signatures
  y = Math.max(y + 30, doc.page.height - 140);
  doc.font("Helvetica").fontSize(10);
  doc.text("Le président du conseil", M, y);
  doc.text("Le directeur des études", W - M - 170, y, { width: 170, align: "center" });
  doc
    .fontSize(8)
    .fillColor("#666")
    .text(
      `PV ${session.number} — document généré le ${new Date().toLocaleDateString("fr-FR")}. ` +
        "Les décisions retenues engagent le conseil de classe ; les propositions " +
        "calculées sont rappelées à titre informatif.",
      M,
      doc.page.height - 60,
      { width: W - 2 * M, align: "center" },
    );
  doc.fillColor("#000");
  doc.end();
  return done;
}

export function deliberationPvFileName(number: string) {
  return `pv-deliberation-${number}.pdf`;
}
