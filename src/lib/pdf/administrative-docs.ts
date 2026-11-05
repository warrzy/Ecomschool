/**
 * G4 — Rendus PDF des documents administratifs.
 *
 * Pattern reçu : rendu déterministe depuis le snapshot persisté
 * (`AdministrativeDocument.payload`) — le PDF re-téléchargé est
 * identique même si les données vivantes évoluent.
 *
 * Sécurité :
 *  - `isTestEnvironment()` → filigrane « TEST » diagonal sur tous les
 *    documents hors production commerciale (préproduction incluse) ;
 *  - le QR code n'embarque QUE l'URL publique de vérification
 *    (code opaque) — aucune donnée sensible encodée ;
 *  - la photo n'est chargée que depuis `public/` (même garde que le
 *    logo) — jamais d'URL distante ni de chemin interne exposé.
 */
import type PDFKit from "pdfkit";
import { loadSchoolLogo } from "./report-card";
import type { AdminDocPayload } from "@/lib/services/administrative-docs";
import { isTestEnvironment } from "@/lib/services/administrative-docs";

export type AdminDocMeta = {
  number: string;
  type: "ATTESTATION_INSCRIPTION" | "CERTIFICAT_SCOLAIRE" | "CARTE_SCOLAIRE";
  status: "ISSUED" | "REVOKED";
  issuedAt: string;
  publicCode: string;
  verifyUrl: string;
};

const ENROLL_STATUS_LABELS: Record<string, string> = {
  ENROLLED: "Inscrit",
  COMPLETED: "Année scolaire terminée",
  WITHDRAWN: "Retiré en cours d'année",
  TRANSFERRED: "Transféré en cours d'année",
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("fr-FR");
};

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

function schoolHeader(
  doc: PDFKit.PDFDocument,
  s: AdminDocPayload["school"],
  opts: { logo?: Buffer | null },
) {
  const W = doc.page.width;
  const M = 40;
  let y = M;
  const logo = opts.logo ?? loadSchoolLogo(s.logoUrl);
  if (logo) {
    try {
      doc.image(logo, M, y, { fit: [60, 60] });
    } catch {
      /* logo illisible — ignoré */
    }
  }
  doc
    .fontSize(15)
    .font("Helvetica-Bold")
    .text(s.name, M + (logo ? 72 : 0), y + 6, { width: W - 2 * M - (logo ? 72 : 0) });
  const contact = [s.address, s.city, s.phone].filter(Boolean).join(" · ");
  if (contact) {
    doc.fontSize(9).font("Helvetica").text(contact, M + (logo ? 72 : 0), y + 28);
  }
  y += 70;
  doc.moveTo(M, y).lineTo(W - M, y).strokeColor("#444").stroke();
  return y + 16;
}

function footerBlock(
  doc: PDFKit.PDFDocument,
  meta: AdminDocMeta,
  qr: Buffer | null,
  opts: { margin?: number; bottom?: number } = {},
) {
  const W = doc.page.width;
  const H = doc.page.height;
  const M = opts.margin ?? 40;
  const qrSize = qr ? 74 : 0;
  const y0 = opts.bottom ?? H - M - 84;

  if (qr) {
    try {
      doc.image(qr, W - M - qrSize, y0, { fit: [qrSize, qrSize] });
    } catch {
      /* QR illisible — le code texte reste */
    }
  }
  doc.fontSize(8).fillColor("#555");
  doc.text(`Référence : ${meta.number}`, M, y0);
  doc.text(`Émis le ${fmtDate(meta.issuedAt)}`, M, y0 + 12);
  doc.text(
    `Vérification en ligne : ${meta.verifyUrl}`,
    M,
    y0 + 24,
    { width: W - 2 * M - qrSize - 12 },
  );
  doc.fillColor("#000");
  return y0;
}

/** Attestation d'inscription — A4 portrait. */
export function renderAttestation(
  doc: PDFKit.PDFDocument,
  payload: AdminDocPayload,
  meta: AdminDocMeta,
  opts: { qr?: Buffer | null } = {},
) {
  let y = schoolHeader(doc, payload.school, {});
  const W = doc.page.width;
  const M = 40;

  if (isTestEnvironment()) watermark(doc, "TEST");
  if (meta.status === "REVOKED") watermark(doc, "RÉVOQUÉ");

  doc
    .fontSize(16)
    .font("Helvetica-Bold")
    .text("ATTESTATION D'INSCRIPTION", M, y, { align: "center", width: W - 2 * M });
  y += 30;
  doc.fontSize(10).font("Helvetica").text(`N° ${meta.number}`, M, y, {
    align: "center",
    width: W - 2 * M,
  });
  y += 36;

  const s = payload.student;
  const sexLabel = s.sex === "FEMALE" ? "inscrite" : "inscrit";
  const verb =
    payload.enrollmentStatus === "ENROLLED"
      ? `est régulièrement ${sexLabel}`
      : `a été ${sexLabel}`;
  doc
    .fontSize(11)
    .font("Helvetica")
    .text(
      `Le soussigné, chef d'établissement de « ${payload.school.name} », atteste que l'élève :`,
      M,
      y,
      { width: W - 2 * M },
    );
  y += 42;

  const row = (label: string, value: string) => {
    doc.font("Helvetica-Bold").fontSize(10).text(label, M, y, { width: 170 });
    doc.font("Helvetica").text(value || "—", M + 180, y, { width: W - 2 * M - 180 });
    y += 20;
  };
  row("Nom et prénom", `${s.lastName.toUpperCase()} ${s.firstName}`);
  row("Matricule", s.matricule);
  if (s.birthDate || s.birthPlace) {
    row("Naissance", `${s.birthPlace ?? "—"}, le ${fmtDate(s.birthDate)}`);
  }
  row("Classe", payload.classroomName ?? "—");
  row("Année scolaire", payload.academicYear);
  row("Date d'inscription", fmtDate(payload.enrolledAt));
  y += 14;
  doc
    .fontSize(11)
    .text(
      `${verb} dans cet établissement pour l'année scolaire ${payload.academicYear}.`,
      M,
      y,
      { width: W - 2 * M },
    );
  y += 34;
  doc.text(
    "En foi de quoi, la présente attestation lui est délivrée pour servir et valoir ce que de droit.",
    M,
    y,
    { width: W - 2 * M },
  );

  // Signature + cachet
  y += 44;
  doc.fontSize(10).text(`Fait à ${payload.school.city ?? "…"}, le ${fmtDate(meta.issuedAt)}`, M, y);
  doc
    .font("Helvetica-Bold")
    .text("Le Chef d'établissement", W - M - 180, y, { width: 180, align: "center" });
  if (payload.issuerName) {
    doc.font("Helvetica").text(payload.issuerName, W - M - 180, y + 60, {
      width: 180,
      align: "center",
    });
  }

  footerBlock(doc, meta, opts.qr ?? null);
}

/** Certificat de scolarité — A4 portrait, QR obligatoire. */
export function renderCertificat(
  doc: PDFKit.PDFDocument,
  payload: AdminDocPayload,
  meta: AdminDocMeta,
  opts: { qr?: Buffer | null } = {},
) {
  let y = schoolHeader(doc, payload.school, {});
  const W = doc.page.width;
  const M = 40;

  if (isTestEnvironment()) watermark(doc, "TEST");
  if (meta.status === "REVOKED") watermark(doc, "RÉVOQUÉ");

  doc
    .fontSize(16)
    .font("Helvetica-Bold")
    .text("CERTIFICAT DE SCOLARITÉ", M, y, { align: "center", width: W - 2 * M });
  y += 30;
  doc.fontSize(10).font("Helvetica").text(`N° ${meta.number}`, M, y, {
    align: "center",
    width: W - 2 * M,
  });
  y += 36;

  const s = payload.student;
  doc
    .fontSize(11)
    .font("Helvetica")
    .text(
      "Nous certifions, pour faire valoir ce que de droit, que l'élève ci-dessous désigné est régulièrement scolarisé dans notre établissement :",
      M,
      y,
      { width: W - 2 * M },
    );
  y += 44;

  const row = (label: string, value: string) => {
    doc.font("Helvetica-Bold").fontSize(10).text(label, M, y, { width: 170 });
    doc.font("Helvetica").text(value || "—", M + 180, y, { width: W - 2 * M - 180 });
    y += 20;
  };
  row("Nom et prénom", `${s.lastName.toUpperCase()} ${s.firstName}`);
  row("Matricule", s.matricule);
  if (s.birthDate || s.birthPlace) {
    row("Naissance", `${s.birthPlace ?? "—"}, le ${fmtDate(s.birthDate)}`);
  }
  row("Classe", payload.classroomName ?? "—");
  row("Année scolaire", payload.academicYear);
  row("Statut d'inscription", ENROLL_STATUS_LABELS[payload.enrollmentStatus] ?? payload.enrollmentStatus);
  y += 20;
  doc
    .fontSize(11)
    .text(
      `Ce certificat atteste la scolarité de l'élève pour l'année ${payload.academicYear}. Son authenticité est vérifiable en ligne grâce au code ou au QR ci-dessous.`,
      M,
      y,
      { width: W - 2 * M },
    );

  y += 44;
  doc.fontSize(10).text(`Fait à ${payload.school.city ?? "…"}, le ${fmtDate(meta.issuedAt)}`, M, y);
  doc
    .font("Helvetica-Bold")
    .text("Le Chef d'établissement", W - M - 180, y, { width: 180, align: "center" });
  if (payload.issuerName) {
    doc.font("Helvetica").text(payload.issuerName, W - M - 180, y + 60, {
      width: 180,
      align: "center",
    });
  }

  footerBlock(doc, meta, opts.qr ?? null);
}

/**
 * Carte scolaire — format carte (85,6 × 54 mm ≈ 243 × 153 pt), page
 * dédiée : photo si disponible, mention TEST hors production.
 */
export function renderSchoolCard(
  doc: PDFKit.PDFDocument,
  payload: AdminDocPayload,
  meta: AdminDocMeta,
  opts: { qr?: Buffer | null; photo?: Buffer | null } = {},
) {
  const W = doc.page.width; // ~243 pt
  const H = doc.page.height; // ~153 pt
  const M = 8;

  if (isTestEnvironment()) {
    doc.save();
    doc
      .rotate(-24, { origin: [W / 2, H / 2] })
      .font("Helvetica-Bold")
      .fontSize(26)
      .fillColor("#c0392b")
      .opacity(0.15)
      .text("TEST", 0, H / 2 - 14, { align: "center", width: W });
    doc.opacity(1).fillColor("#000");
    doc.restore();
  }
  if (meta.status === "REVOKED") {
    doc.save();
    doc
      .rotate(-24, { origin: [W / 2, H / 2] })
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor("#c0392b")
      .opacity(0.25)
      .text("RÉVOQUÉ", 0, H / 2 - 10, { align: "center", width: W });
    doc.opacity(1).fillColor("#000");
    doc.restore();
  }

  // Bandeau établissement
  doc.rect(0, 0, W, 24).fill("#1f3a5f");
  doc
    .fillColor("#fff")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(payload.school.name, M, 8, { width: W - 2 * M, align: "center" });
  doc.fillColor("#000");

  // Photo élève (locale uniquement — même garde que le logo)
  const photo = opts.photo ?? null;
  const photoW = 56;
  if (photo) {
    try {
      doc.image(photo, M, 32, { fit: [photoW, 66] });
    } catch {
      /* photo illisible */
    }
  } else {
    doc.rect(M, 32, photoW, 66).strokeColor("#999").stroke();
    doc.fontSize(6).fillColor("#999").text("PHOTO", M, 62, { width: photoW, align: "center" });
    doc.fillColor("#000");
  }

  const s = payload.student;
  const tx = M + photoW + 8;
  const qrSize = opts.qr ? 52 : 0;
  let y = 34;
  doc.font("Helvetica-Bold").fontSize(9);
  doc.text(`${s.lastName.toUpperCase()} ${s.firstName}`, tx, y, { width: W - tx - M - qrSize });
  y += 14;
  doc.font("Helvetica").fontSize(7);
  doc.text(`Matricule : ${s.matricule}`, tx, y); y += 10;
  doc.text(`Classe : ${payload.classroomName ?? "—"}`, tx, y); y += 10;
  doc.text(`Année : ${payload.academicYear}`, tx, y); y += 10;
  doc.fontSize(6).fillColor("#555");
  doc.text(`N° ${meta.number} · Émise le ${fmtDate(meta.issuedAt)}`, tx, y + 6, {
    width: W - tx - M - qrSize,
  });
  doc.fillColor("#000");

  if (opts.qr) {
    try {
      doc.image(opts.qr, W - M - qrSize, 34, { fit: [qrSize, qrSize] });
    } catch {
      /* QR illisible */
    }
  }

  // Pied de carte
  doc.rect(0, H - 18, W, 18).fill("#eef1f5");
  doc
    .fillColor("#333")
    .font("Helvetica")
    .fontSize(6)
    .text("Carte strictement personnelle — vérification : voir code QR", M, H - 12, {
      width: W - 2 * M,
      align: "center",
    });
  doc.fillColor("#000");
}
