import type PDFKit from "pdfkit";
import { loadSchoolLogo } from "./report-card";

export type ReceiptSnapshot = {
  receiptNumber: string;
  issuedAt: string;
  school: {
    name: string;
    logoUrl: string | null;
    address: string | null;
    city: string | null;
    phone: string | null;
  } | null;
  student: {
    matricule: string;
    firstName: string;
    lastName: string;
    classroomName: string | null;
  };
  academicYear: string;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  observation: string | null;
  agent: string | null;
  balanceAfter: number;
  allocations: { installmentId: string; amount: number }[];
};

const METHOD_LABELS: Record<string, string> = {
  CASH: "Espèces",
  BANK_TRANSFER: "Virement bancaire",
  CHECK: "Chèque",
  MOBILE_MONEY: "Mobile Money",
  OTHER: "Autre",
};

export function formatAmount(amount: number, currency = "XOF") {
  return `${amount.toLocaleString("fr-FR")} ${currency === "XOF" ? "FCFA" : currency}`;
}

/**
 * Rend le reçu depuis le snapshot persisté — historiquement identique
 * même si la configuration de l'école change ensuite.
 */
export function renderReceipt(
  doc: PDFKit.PDFDocument,
  s: ReceiptSnapshot,
  opts: { format?: "A4" | "A5"; logo?: Buffer | null } = {},
) {
  const W = doc.page.width;
  const M = 40;
  const logo = opts.logo ?? loadSchoolLogo(s.school?.logoUrl);
  let y = M;

  if (logo) {
    try {
      doc.image(logo, M, y, { fit: [64, 64] });
    } catch {
      // logo illisible — ignoré
    }
  }
  doc
    .fontSize(16)
    .font("Helvetica-Bold")
    .text(s.school?.name ?? "Établissement", M + (logo ? 76 : 0), y + 8, {
      width: W - 2 * M - (logo ? 76 : 0),
    });
  doc.fontSize(9).font("Helvetica");
  const contact = [s.school?.address, s.school?.city, s.school?.phone].filter(Boolean).join(" · ");
  if (contact) doc.text(contact, M + (logo ? 76 : 0), y + 30);
  y += 76;

  doc
    .moveTo(M, y)
    .lineTo(W - M, y)
    .strokeColor("#444")
    .stroke();
  y += 14;

  doc.fontSize(15).font("Helvetica-Bold").text("REÇU DE PAIEMENT", M, y, {
    align: "center",
    width: W - 2 * M,
  });
  y += 24;
  doc
    .fontSize(10)
    .font("Helvetica")
    .text(`N° ${s.receiptNumber}`, M, y, { align: "center", width: W - 2 * M });
  y += 26;

  const issued = new Date(s.issuedAt);
  const dateStr = `${issued.toLocaleDateString("fr-FR")} ${issued.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;

  const row = (label: string, value: string) => {
    doc.font("Helvetica-Bold").fontSize(10).text(label, M, y, { width: 170 });
    doc.font("Helvetica").text(value || "—", M + 180, y, { width: W - 2 * M - 180 });
    y += 18;
  };

  row("Date", dateStr);
  row("Élève", `${s.student.firstName} ${s.student.lastName} (${s.student.matricule})`);
  if (s.student.classroomName) row("Classe", s.student.classroomName);
  row("Année scolaire", s.academicYear);
  row("Mode de paiement", METHOD_LABELS[s.method] ?? s.method);
  if (s.reference) row("Référence", s.reference);
  if (s.agent) row("Agent de caisse", s.agent);
  if (s.observation) row("Observation", s.observation);

  y += 8;
  doc.moveTo(M, y).lineTo(W - M, y).strokeColor("#bbb").stroke();
  y += 12;

  doc
    .fontSize(13)
    .font("Helvetica-Bold")
    .text(`Montant encaissé : ${formatAmount(s.amount, s.currency)}`, M, y, {
      width: W - 2 * M,
    });
  y += 24;
  doc
    .fontSize(10)
    .font("Helvetica")
    .text(`Solde restant après ce paiement : ${formatAmount(s.balanceAfter, s.currency)}`, M, y);
  y += 30;

  doc
    .fontSize(8)
    .fillColor("#666")
    .text(
      "Reçu généré électroniquement — toute annulation fait l'objet d'une contre-écriture auditée. Document conservé à titre de preuve de paiement.",
      M,
      y,
      { width: W - 2 * M },
    );
  doc.fillColor("#000");
}
