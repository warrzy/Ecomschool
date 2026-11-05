/**
 * G4 — Assemblage PDF d'un document administratif émis :
 * QR code (URL de vérification uniquement), photo locale éventuelle,
 * format adapté au type. Partagé par les routes admin et parent —
 * l'autorisation est faite en amont par l'appelant.
 */
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { AdministrativeDocument } from "@prisma/client";
import { loadSchoolLogo } from "./report-card";
import {
  renderAttestation,
  renderCertificat,
  renderSchoolCard,
  type AdminDocMeta,
} from "./administrative-docs";
import type { AdminDocPayload } from "@/lib/services/administrative-docs";
import { verificationUrl } from "@/lib/services/administrative-docs";

type DocRow = Pick<
  AdministrativeDocument,
  "type" | "number" | "status" | "issuedAt" | "publicCode" | "payload"
>;

const CARD_SIZE: [number, number] = [242.65, 153.0]; // 85,6 × 54 mm

export async function buildAdminDocPdf(doc: DocRow): Promise<Buffer> {
  const payload = doc.payload as unknown as AdminDocPayload;
  const meta: AdminDocMeta = {
    number: doc.number,
    type: doc.type,
    status: doc.status,
    issuedAt: doc.issuedAt.toISOString(),
    publicCode: doc.publicCode,
    verifyUrl: verificationUrl(doc.publicCode),
  };

  const [qr, photo] = await Promise.all([
    QRCode.toBuffer(meta.verifyUrl, { type: "png", margin: 1, width: 160 }).catch(
      () => null,
    ),
    doc.type === "CARTE_SCOLAIRE"
      ? Promise.resolve(loadSchoolLogo(payload.student.photoUrl))
      : Promise.resolve(null),
  ]);

  const isCard = doc.type === "CARTE_SCOLAIRE";
  const pdf = new PDFDocument({
    size: isCard ? CARD_SIZE : "A4",
    margin: 0,
    info: { Title: `${doc.type} ${doc.number}` },
  });
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    pdf.on("end", () => resolve(Buffer.concat(chunks))),
  );

  if (doc.type === "ATTESTATION_INSCRIPTION") {
    renderAttestation(pdf, payload, meta, { qr });
  } else if (doc.type === "CERTIFICAT_SCOLAIRE") {
    renderCertificat(pdf, payload, meta, { qr });
  } else {
    renderSchoolCard(pdf, payload, meta, { qr, photo });
  }
  pdf.end();
  return done;
}

export function adminDocFileName(doc: Pick<DocRow, "type" | "number">) {
  const label =
    doc.type === "ATTESTATION_INSCRIPTION"
      ? "attestation"
      : doc.type === "CERTIFICAT_SCOLAIRE"
        ? "certificat"
        : "carte-scolaire";
  return `${label}-${doc.number}.pdf`;
}
