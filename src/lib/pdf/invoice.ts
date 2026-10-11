import type PDFKit from "pdfkit";
import { formatAmount } from "./receipt";

export type InvoiceSnapshot = {
  invoiceNumber: string;
  issuer: {
    legalName: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
    taxId: string | null;
  };
  customer: { name: string; code: string; address: string | null; city: string | null };
  lines: { label: string; quantity: number; unitPrice: number; amount: number }[];
  total: number;
  currency: string;
  issueDate: string;
  dueDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  cycle: string;
  planName: string | null;
  footer: string | null;
};

export function renderInvoice(doc: PDFKit.PDFDocument, s: InvoiceSnapshot) {
  const W = doc.page.width;
  const M = 45;
  let y = M;

  doc.fontSize(18).font("Helvetica-Bold").text(s.issuer.legalName ?? "ECOM-TOUCH", M, y);
  doc.fontSize(9).font("Helvetica");
  const contact = [s.issuer.address, s.issuer.city, s.issuer.country, s.issuer.phone, s.issuer.email]
    .filter(Boolean)
    .join(" · ");
  if (contact) doc.text(contact, M, y + 22);
  if (s.issuer.taxId) doc.text(`NIF : ${s.issuer.taxId}`, M, y + 34);

  doc.fontSize(16).font("Helvetica-Bold").text("FACTURE", W - M - 200, y, {
    width: 200,
    align: "right",
  });
  doc.fontSize(10).font("Helvetica").text(`N° ${s.invoiceNumber}`, W - M - 200, y + 20, {
    width: 200,
    align: "right",
  });
  y += 60;

  doc.moveTo(M, y).lineTo(W - M, y).strokeColor("#444").stroke();
  y += 16;

  doc.font("Helvetica-Bold").fontSize(10).text("Facturé à :", M, y);
  y += 14;
  doc.font("Helvetica").text(s.customer.name, M, y);
  y += 13;
  doc.fontSize(9).text(`Code : ${s.customer.code}`, M, y);
  if (s.customer.address || s.customer.city) {
    y += 12;
    doc.text([s.customer.address, s.customer.city].filter(Boolean).join(", "), M, y);
  }
  y += 24;

  const df = (iso: string) => new Date(iso).toLocaleDateString("fr-FR");
  doc.fontSize(9).font("Helvetica")
    .text(`Date d'émission : ${df(s.issueDate)}`, M, y)
    .text(`Échéance : ${df(s.dueDate)}`, M + 220, y);
  if (s.periodStart && s.periodEnd) {
    y += 14;
    doc.text(`Période : ${df(s.periodStart)} → ${df(s.periodEnd)} (${s.cycle === "YEARLY" ? "annuel" : "mensuel"})`, M, y);
  }
  if (s.planName) {
    y += 14;
    doc.text(`Offre : ${s.planName}`, M, y);
  }
  y += 24;

  // Table des lignes
  const cols = { label: M, qty: W - M - 260, unit: W - M - 170, amount: W - M - 90 };
  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("Description", cols.label, y);
  doc.text("Qté", cols.qty, y, { width: 60, align: "right" });
  doc.text("Prix unitaire", cols.unit, y, { width: 80, align: "right" });
  doc.text("Montant", cols.amount, y, { width: 90, align: "right" });
  y += 14;
  doc.moveTo(M, y).lineTo(W - M, y).strokeColor("#bbb").stroke();
  y += 8;

  doc.font("Helvetica");
  for (const l of s.lines) {
    doc.text(l.label, cols.label, y, { width: cols.qty - cols.label - 10 });
    doc.text(String(l.quantity), cols.qty, y, { width: 60, align: "right" });
    doc.text(formatAmount(l.unitPrice, s.currency), cols.unit, y, { width: 80, align: "right" });
    doc.text(formatAmount(l.amount, s.currency), cols.amount, y, { width: 90, align: "right" });
    y += 16;
  }

  y += 8;
  doc.moveTo(M, y).lineTo(W - M, y).strokeColor("#bbb").stroke();
  y += 12;
  doc.font("Helvetica-Bold").fontSize(12).text(
    `Total : ${formatAmount(s.total, s.currency)}`,
    M,
    y,
    { width: W - 2 * M, align: "right" },
  );
  y += 30;

  if (s.footer) {
    doc.fontSize(8).font("Helvetica").fillColor("#666").text(s.footer, M, y, {
      width: W - 2 * M,
    });
    y += 24;
  }
  doc
    .fontSize(8)
    .fillColor("#666")
    .text("Facture générée par la plateforme ECOM-SCHOOL — ECOM-TOUCH.", M, doc.page.height - 60, {
      width: W - 2 * M,
      align: "center",
    });
  doc.fillColor("#000");
}
