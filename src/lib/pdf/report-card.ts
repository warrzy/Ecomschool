import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export type ReportCardPayload = {
  school: {
    name: string;
    logoUrl: string | null;
    address: string | null;
    city: string | null;
    phone: string | null;
    email: string | null;
  };
  student: {
    matricule: string;
    firstName: string;
    lastName: string;
    birthDate: string | null;
    sex?: string | null;
  };
  classroom: { name: string; level?: { name: string } | null };
  period: { name: string; number: number; academicYear: { name: string } };
  classSize: number;
  generalAverage: number | null;
  rank: number | null;
  mention: string | null;
  absences: number;
  lates: number;
  headTeacherNote?: string | null;
  generalAppreciation?: string | null;
  councilDecision?: string | null;
  directionNote?: string | null;
  directionSignedAt?: string | null;
  subjects: {
    name: string;
    group?: string | null;
    average: number | null;
    coefficient: number | null;
    weightedPoints: number | null;
    rank: number | null;
    appreciation: string | null;
  }[];
};

export type ReportCardMeta = {
  identifier: string;
  version: number;
  status: string;
  publishedAt: Date | null;
};

/** Champs affichables par modèle (fusionnés avec les défauts du modèle). */
export type ReportCardLayout = {
  showRank?: boolean;
  showCoefficients?: boolean;
  showPoints?: boolean;
  showAppreciations?: boolean;
  showAbsences?: boolean;
  showMention?: boolean;
  showBirthDate?: boolean;
  showGroups?: boolean;
  showCouncilDecision?: boolean;
  showDirectionNote?: boolean;
  showHeadTeacherNote?: boolean;
};

const DEFAULTS: Record<string, Required<ReportCardLayout>> = {
  primary: {
    showRank: false,
    showCoefficients: false,
    showPoints: false,
    showAppreciations: true,
    showAbsences: true,
    showMention: false,
    showBirthDate: true,
    showGroups: false,
    showCouncilDecision: false,
    showDirectionNote: false,
    showHeadTeacherNote: true,
  },
  college: {
    showRank: true,
    showCoefficients: true,
    showPoints: false,
    showAppreciations: true,
    showAbsences: true,
    showMention: true,
    showBirthDate: true,
    showGroups: false,
    showCouncilDecision: true,
    showDirectionNote: true,
    showHeadTeacherNote: true,
  },
  lycee: {
    showRank: true,
    showCoefficients: true,
    showPoints: true,
    showAppreciations: true,
    showAbsences: true,
    showMention: true,
    showBirthDate: true,
    showGroups: true,
    showCouncilDecision: true,
    showDirectionNote: true,
    showHeadTeacherNote: true,
  },
  standard: {
    showRank: true,
    showCoefficients: true,
    showPoints: true,
    showAppreciations: true,
    showAbsences: true,
    showMention: true,
    showBirthDate: true,
    showGroups: false,
    showCouncilDecision: true,
    showDirectionNote: true,
    showHeadTeacherNote: true,
  },
};

export const fmtDate = (d: Date | string | null | undefined) => {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
};

export function loadSchoolLogo(logoUrl: string | null | undefined): Buffer | null {
  if (!logoUrl?.startsWith("/")) return null;
  const p = join(process.cwd(), "public", logoUrl);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p);
  } catch {
    return null;
  }
}

function header(
  doc: PDFKit.PDFDocument,
  payload: ReportCardPayload,
  title: string,
  logo: Buffer | null,
  L: number,
  W: number,
) {
  if (logo) {
    try {
      doc.image(logo, L, 36, { height: 40 });
    } catch {
      /* logo illisible */
    }
  }
  doc.fontSize(14).font("Helvetica-Bold").text(payload.school.name, logo ? L + 52 : L, 40);
  doc.fontSize(8).font("Helvetica");
  const contact = [payload.school.address, payload.school.city, payload.school.phone, payload.school.email]
    .filter(Boolean)
    .join(" — ");
  if (contact) doc.text(contact, logo ? L + 52 : L, 58, { width: W - 52 });
  doc.fontSize(12).font("Helvetica-Bold").text(title, L, 92, { width: W, align: "center" });
  doc.fontSize(9).font("Helvetica")
    .text(`${payload.period.academicYear.name} — ${payload.period.name}`, L, 110, {
      width: W,
      align: "center",
    });
}

function studentBlock(
  doc: PDFKit.PDFDocument,
  payload: ReportCardPayload,
  lay: Required<ReportCardLayout>,
  L: number,
  W: number,
  y: number,
) {
  doc.rect(L, y, W, 44).strokeColor("#d4d4d8").stroke();
  doc.fontSize(9).font("Helvetica-Bold")
    .text(`${payload.student.lastName} ${payload.student.firstName}`, L + 8, y + 6);
  doc.font("Helvetica").fontSize(8)
    .text(`Matricule : ${payload.student.matricule}`, L + 8, y + 20)
    .text(
      lay.showBirthDate && payload.student.birthDate
        ? `Né(e) le : ${fmtDate(payload.student.birthDate)}`
        : "",
      L + 8, y + 30,
    )
    .text(`Classe : ${payload.classroom.name}`, L + 300, y + 6)
    .text(`Effectif : ${payload.classSize}`, L + 300, y + 20);
  return y + 56;
}

function footer(doc: PDFKit.PDFDocument, meta: ReportCardMeta, L: number, W: number) {
  doc.fontSize(7).fillColor("#71717a")
    .text(
      `Bulletin ${meta.identifier} · v${meta.version} · ${meta.status}${meta.publishedAt ? ` · publié le ${fmtDate(meta.publishedAt)}` : ""} · édité le ${fmtDate(new Date())}`,
      L,
      812,
      { width: W, align: "center" },
    );
  doc.fillColor("#18181b");
}

// ---------- Primaire : disciplines, pas de coefficients, décision pédagogique ----------
function renderPrimary(
  doc: PDFKit.PDFDocument,
  p: ReportCardPayload,
  meta: ReportCardMeta,
  lay: Required<ReportCardLayout>,
  logo: Buffer | null,
) {
  const L = 40;
  const W = 515;
  header(doc, p, "BULLETIN DE FIN DE PÉRIODE — PRIMAIRE", logo, L, W);
  let y = studentBlock(doc, p, lay, L, W, 132);

  // Tableau « Disciplines » : Matière | Moyenne | Appréciation
  const cols = { subject: 200, avg: 70, appr: W - 270 };
  doc.fontSize(9).font("Helvetica-Bold");
  doc.text("Discipline", L + 4, y + 4);
  doc.text("Moyenne", L + 4 + cols.subject, y + 4);
  doc.text("Appréciation", L + 4 + cols.subject + cols.avg, y + 4);
  doc.moveTo(L, y + 16).lineTo(L + W, y + 16).stroke();
  y += 18;
  doc.font("Helvetica");
  for (const s of p.subjects) {
    doc.fontSize(9).text(s.name, L + 4, y, { width: cols.subject - 8 });
    doc.text(s.average != null ? s.average.toFixed(2) : "—", L + 4 + cols.subject, y);
    if (lay.showAppreciations) {
      doc.fontSize(8).text(s.appreciation ?? "", L + 4 + cols.subject + cols.avg, y, {
        width: cols.appr - 8,
      });
    }
    y += 16;
    doc.moveTo(L, y).lineTo(L + W, y).strokeColor("#e4e4e7").stroke();
    y += 2;
  }

  // Résultat général
  y += 12;
  doc.rect(L, y, W, 40).strokeColor("#d4d4d8").stroke();
  doc.fontSize(9).font("Helvetica-Bold").text("Résultat général", L + 8, y + 6);
  doc.font("Helvetica").fontSize(8)
    .text(`Moyenne générale : ${p.generalAverage != null ? `${p.generalAverage.toFixed(2)}/20` : "—"}`, L + 8, y + 20)
    .text(lay.showAbsences ? `Absences : ${p.absences} · Retards : ${p.lates}` : "", L + 240, y + 20);

  // Appréciation du professeur principal
  y += 52;
  doc.rect(L, y, W, 52).strokeColor("#d4d4d8").stroke();
  doc.fontSize(9).font("Helvetica-Bold").text("Appréciation du professeur principal", L + 8, y + 6);
  doc.font("Helvetica").fontSize(8)
    .text(p.headTeacherNote ?? "_____________________________________________________________", L + 8, y + 20, { width: W - 16 });

  // Décision pédagogique + signatures
  y += 64;
  doc.rect(L, y, W / 2 - 4, 66).strokeColor("#d4d4d8").stroke();
  doc.fontSize(9).font("Helvetica-Bold").text("Décision pédagogique", L + 8, y + 6);
  doc.font("Helvetica").fontSize(8)
    .text(p.councilDecision ?? "_______________________________", L + 8, y + 20, { width: W / 2 - 20 });
  doc.rect(L + W / 2 + 4, y, W / 2 - 4, 66).strokeColor("#d4d4d8").stroke();
  doc.font("Helvetica-Bold").fontSize(9).text("Signatures", L + W / 2 + 12, y + 6);
  doc.font("Helvetica").fontSize(8)
    .text("Le professeur :", L + W / 2 + 12, y + 22)
    .text("Le directeur / la directrice :", L + W / 2 + 12, y + 40);

  footer(doc, meta, L, W);
}

// ---------- Collège : coefficients, rang, absences, décision de la direction ----------
function renderCollege(
  doc: PDFKit.PDFDocument,
  p: ReportCardPayload,
  meta: ReportCardMeta,
  lay: Required<ReportCardLayout>,
  logo: Buffer | null,
) {
  const L = 40;
  const W = 515;
  header(doc, p, "BULLETIN DE NOTES — COLLÈGE", logo, L, W);
  let y = studentBlock(doc, p, lay, L, W, 132);

  const cols = { subject: 165, coef: 45, avg: 55, rank: 45, appr: W - 310 };
  doc.fontSize(8).font("Helvetica-Bold");
  doc.text("Matière", L + 4, y + 4);
  doc.text("Coef.", L + 4 + cols.subject, y + 4);
  doc.text("Moyenne", L + 4 + cols.subject + cols.coef, y + 4);
  doc.text("Rang", L + 4 + cols.subject + cols.coef + cols.avg, y + 4);
  doc.text("Appréciation", L + 4 + cols.subject + cols.coef + cols.avg + cols.rank, y + 4);
  doc.moveTo(L, y + 16).lineTo(L + W, y + 16).stroke();
  y += 18;
  doc.font("Helvetica");
  for (const s of p.subjects) {
    doc.fontSize(8).text(s.name, L + 4, y, { width: cols.subject - 8 });
    doc.text(lay.showCoefficients && s.coefficient != null ? String(s.coefficient) : "—", L + 4 + cols.subject, y);
    doc.text(s.average != null ? s.average.toFixed(2) : "—", L + 4 + cols.subject + cols.coef, y);
    doc.text(lay.showRank && s.rank != null ? String(s.rank) : "—", L + 4 + cols.subject + cols.coef + cols.avg, y);
    if (lay.showAppreciations) {
      doc.text(s.appreciation ?? "", L + 4 + cols.subject + cols.coef + cols.avg + cols.rank, y, {
        width: cols.appr - 8,
      });
    }
    y += 14;
    doc.moveTo(L, y).lineTo(L + W, y).strokeColor("#e4e4e7").stroke();
    y += 2;
  }

  // Synthèse en deux colonnes
  y += 12;
  doc.rect(L, y, W, 84).strokeColor("#d4d4d8").stroke();
  doc.fontSize(9).font("Helvetica-Bold").text("Synthèse", L + 8, y + 6);
  doc.font("Helvetica").fontSize(8)
    .text(`Moyenne générale : ${p.generalAverage != null ? `${p.generalAverage.toFixed(2)}/20` : "—"}`, L + 8, y + 22)
    .text(lay.showRank ? `Rang : ${p.rank != null ? `${p.rank} / ${p.classSize}` : "—"}` : "", L + 8, y + 34)
    .text(lay.showMention ? `Mention : ${p.mention ?? "—"}` : "", L + 8, y + 46)
    .text(lay.showAbsences ? `Absences : ${p.absences} · Retards : ${p.lates}` : "", L + 8, y + 58);
  doc.fontSize(8)
    .text("Appréciation générale :", L + 240, y + 22)
    .text(p.generalAppreciation ?? "_________________________________", L + 240, y + 34, { width: 260 })
    .text("Décision de la direction :", L + 240, y + 50)
    .text(p.directionNote ?? p.councilDecision ?? "_________________________________", L + 240, y + 62, { width: 260 });

  if (lay.showHeadTeacherNote && p.headTeacherNote) {
    y += 96;
    doc.rect(L, y, W, 40).strokeColor("#d4d4d8").stroke();
    doc.fontSize(8).font("Helvetica-Bold").text("Appréciation du professeur principal", L + 8, y + 6);
    doc.font("Helvetica").text(p.headTeacherNote, L + 8, y + 18, { width: W - 16 });
  }

  doc.fontSize(8).font("Helvetica")
    .text("Fait à __________________, le ______________", L + 280, 760)
    .text("La Direction", L + 280, 774);
  footer(doc, meta, L, W);
}

// ---------- Lycée : groupes de matières, points pondérés, mentions ----------
function renderLycee(
  doc: PDFKit.PDFDocument,
  p: ReportCardPayload,
  meta: ReportCardMeta,
  lay: Required<ReportCardLayout>,
  logo: Buffer | null,
) {
  const L = 40;
  const W = 515;
  header(doc, p, "RELEVÉ DE NOTES — LYCÉE", logo, L, W);
  let y = studentBlock(doc, p, lay, L, W, 132);

  const groups = new Map<string, typeof p.subjects>();
  if (lay.showGroups) {
    for (const s of p.subjects) {
      const g = s.group?.trim() || "Autres matières";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(s);
    }
  } else {
    groups.set("", p.subjects);
  }

  const cols = { subject: 140, coef: 40, avg: 55, pts: 55, rank: 45, appr: W - 335 };
  for (const [group, subjects] of groups) {
    if (group) {
      doc.rect(L, y, W, 16).fill("#f4f4f5");
      doc.fillColor("#18181b").fontSize(8).font("Helvetica-Bold")
        .text(group.toUpperCase(), L + 4, y + 4);
      y += 20;
    }
    doc.fontSize(8).font("Helvetica-Bold");
    doc.text("Matière", L + 4, y + 4);
    doc.text("Coef.", L + 4 + cols.subject, y + 4);
    doc.text("Moy.", L + 4 + cols.subject + cols.coef, y + 4);
    doc.text("Points", L + 4 + cols.subject + cols.coef + cols.avg, y + 4);
    doc.text("Rang", L + 4 + cols.subject + cols.coef + cols.avg + cols.pts, y + 4);
    doc.text("Appréciation", L + 4 + cols.subject + cols.coef + cols.avg + cols.pts + cols.rank, y + 4);
    doc.moveTo(L, y + 16).lineTo(L + W, y + 16).stroke();
    y += 18;
    doc.font("Helvetica");
    let groupCoef = 0;
    let groupPoints = 0;
    for (const s of subjects) {
      doc.fontSize(8).text(s.name, L + 4, y, { width: cols.subject - 8 });
      doc.text(s.coefficient != null ? String(s.coefficient) : "—", L + 4 + cols.subject, y);
      doc.text(s.average != null ? s.average.toFixed(2) : "—", L + 4 + cols.subject + cols.coef, y);
      doc.text(lay.showPoints && s.weightedPoints != null ? s.weightedPoints.toFixed(2) : "—", L + 4 + cols.subject + cols.coef + cols.avg, y);
      doc.text(lay.showRank && s.rank != null ? String(s.rank) : "—", L + 4 + cols.subject + cols.coef + cols.avg + cols.pts, y);
      if (lay.showAppreciations) {
        doc.text(s.appreciation ?? "", L + 4 + cols.subject + cols.coef + cols.avg + cols.pts + cols.rank, y, { width: cols.appr - 8 });
      }
      if (s.coefficient != null && s.weightedPoints != null) {
        groupCoef += s.coefficient;
        groupPoints += s.weightedPoints;
      }
      y += 14;
      doc.moveTo(L, y).lineTo(L + W, y).strokeColor("#e4e4e7").stroke();
      y += 2;
    }
    if (group && groupCoef > 0) {
      doc.fontSize(8).font("Helvetica-Bold")
        .text(`Moyenne du groupe : ${(groupPoints / groupCoef).toFixed(2)}`, L + 4, y, { width: W - 8, align: "right" });
      y += 16;
    }
  }

  // Synthèse + mention + classement
  y += 12;
  doc.rect(L, y, W, 96).strokeColor("#d4d4d8").stroke();
  doc.fontSize(9).font("Helvetica-Bold").text("Résultats", L + 8, y + 6);
  doc.font("Helvetica").fontSize(8)
    .text(`Moyenne générale : ${p.generalAverage != null ? `${p.generalAverage.toFixed(2)}/20` : "—"}`, L + 8, y + 22)
    .text(`Classement : ${p.rank != null ? `${p.rank}e / ${p.classSize}` : "—"}`, L + 8, y + 34)
    .text(lay.showMention ? `Mention : ${p.mention ?? "—"}` : "", L + 8, y + 46)
    .text(lay.showAbsences ? `Absences : ${p.absences} · Retards : ${p.lates}` : "", L + 8, y + 58);

  doc.fontSize(8)
    .text("Décision du conseil de classe :", L + 240, y + 22)
    .text(p.councilDecision ?? "_________________________________", L + 240, y + 34, { width: 260 })
    .text("Observation de la direction :", L + 240, y + 50)
    .text(p.directionNote ?? "_________________________________", L + 240, y + 62, { width: 260 })
    .text(
      p.directionSignedAt ? `Validé le ${fmtDate(p.directionSignedAt)}` : "Signature : ____________",
      L + 240, y + 78,
    );

  if (p.headTeacherNote || p.generalAppreciation) {
    y += 108;
    doc.rect(L, y, W, 40).strokeColor("#d4d4d8").stroke();
    doc.fontSize(8).font("Helvetica-Bold").text("Appréciations", L + 8, y + 6);
    doc.font("Helvetica")
      .text(p.generalAppreciation ?? p.headTeacherNote ?? "", L + 8, y + 18, { width: W - 16 });
  }

  footer(doc, meta, L, W);
}

export function renderReportCard(
  doc: PDFKit.PDFDocument,
  payload: ReportCardPayload,
  meta: ReportCardMeta,
  options: { templateKey?: string; layout?: ReportCardLayout | null; logo?: Buffer | null } = {},
) {
  const key = options.templateKey ?? "standard";
  const lay = { ...(DEFAULTS[key] ?? DEFAULTS.standard), ...(options.layout ?? {}) };
  const logo = options.logo ?? null;
  if (key === "primary") return renderPrimary(doc, payload, meta, lay, logo);
  if (key === "college") return renderCollege(doc, payload, meta, lay, logo);
  if (key === "lycee") return renderLycee(doc, payload, meta, lay, logo);
  return renderCollege(doc, payload, meta, lay, logo);
}
