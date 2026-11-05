/**
 * G4 — Documents administratifs scolaires : attestation d'inscription,
 * certificat de scolarité, carte scolaire.
 *
 * Modèle (pattern reçu F2) : le document est une LIGNE d'émission
 * (`AdministrativeDocument`) portant un snapshot métier figé — le PDF
 * est régénéré à la volée, historiquement identique même si l'élève,
 * la classe ou l'établissement évoluent ensuite. Aucun fichier n'est
 * persisté : pas de quota, pas de chemin de stockage exposé.
 *
 * Numérotation : `DOC-YYYY-NNNNN` attribuée sous verrou advisory
 * transactionnel par école + contrainte unique (schoolId, number) —
 * pas de trou ni de doublon sous concurrence.
 *
 * Vérification publique : `publicCode` opaque (192 bits aléatoires,
 * non prédictible, distinct de l'id interne). La route publique
 * renvoie VALIDE / RÉVOQUÉ / INCONNU et les seules informations
 * nécessaires à la comparaison avec le document papier — jamais
 * d'identifiant interne, jamais de coordonnées.
 *
 * Permissions :
 *   administrative-docs.read   → historique + téléchargement
 *   administrative-docs.issue  → émission, révocation, réémission
 * Accès parent : `portal.parent` + rattachement vérifié à l'élève
 * (`verifyChildAccess`), documents ISSUED uniquement.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { verifyChildAccess } from "@/lib/services/portal/parent";
import type { AdminDocumentStatus, AdminDocumentType } from "@prisma/client";

export type AdminDocsError =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NOT_ENROLLED"
  | "INVALID_STATE"
  | "INVALID_INPUT";

export type AdminDocsResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: AdminDocsError };

type SchoolCtx = { userId: string; schoolId: string };

const TYPE_LABELS: Record<AdminDocumentType, string> = {
  ATTESTATION_INSCRIPTION: "Attestation d'inscription",
  CERTIFICAT_SCOLAIRE: "Certificat de scolarité",
  CARTE_SCOLAIRE: "Carte scolaire",
};

export const ADMIN_DOC_TYPE_LABELS = TYPE_LABELS;

/** Vrai hors production commerciale → filigrane « TEST » sur les PDF. */
export function isTestEnvironment() {
  return process.env.APP_ENV !== "production";
}

/** URL publique de vérification — calculée côté serveur. */
export function verificationUrl(publicCode: string) {
  const base = (process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "").replace(/\/+$/, "");
  return base ? `${base}/verifier/${publicCode}` : `/verifier/${publicCode}`;
}

async function hasPerm(ctx: SchoolCtx, key: string) {
  return userHasSchoolPermission({
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    permissionKey: key,
  });
}

export async function canReadAdminDocs(ctx: SchoolCtx) {
  return (
    (await hasPerm(ctx, "administrative-docs.read")) ||
    (await hasPerm(ctx, "administrative-docs.issue"))
  );
}

// ---------- Snapshot métier ----------

export type AdminDocPayload = {
  school: {
    name: string;
    logoUrl: string | null;
    address: string | null;
    city: string | null;
    phone: string | null;
  };
  student: {
    matricule: string;
    firstName: string;
    lastName: string;
    sex: string | null;
    birthDate: string | null;
    birthPlace: string | null;
    photoUrl: string | null;
  };
  academicYear: string;
  classroomName: string | null;
  enrollmentStatus: string;
  enrolledAt: string;
  issuerName: string | null;
};

async function buildPayload(
  ctx: SchoolCtx,
  input: { studentId: string; academicYearId?: string },
): Promise<{ payload: AdminDocPayload; academicYearId: string } | null> {
  const year = input.academicYearId
    ? await prisma.academicYear.findFirst({
        where: { id: input.academicYearId, schoolId: ctx.schoolId },
      })
    : await prisma.academicYear.findFirst({
        where: { schoolId: ctx.schoolId, isCurrent: true },
      });
  if (!year) return null;

  const enrollment = await prisma.enrollment.findFirst({
    where: {
      schoolId: ctx.schoolId,
      studentId: input.studentId,
      academicYearId: year.id,
      status: { in: ["ENROLLED", "COMPLETED", "WITHDRAWN", "TRANSFERRED"] },
    },
    include: {
      student: true,
      classroom: { select: { name: true } },
    },
  });
  // Un document administratif n'atteste que d'une inscription réelle.
  if (!enrollment || enrollment.student.status !== "ACTIVE") return null;

  const [school, issuer] = await Promise.all([
    prisma.school.findUnique({
      where: { id: ctx.schoolId },
      select: { name: true, logoUrl: true, address: true, city: true, phone: true },
    }),
    prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { firstName: true, lastName: true },
    }),
  ]);

  const s = enrollment.student;
  return {
    academicYearId: year.id,
    payload: {
      school: {
        name: school?.name ?? "",
        logoUrl: school?.logoUrl ?? null,
        address: school?.address ?? null,
        city: school?.city ?? null,
        phone: school?.phone ?? null,
      },
      student: {
        matricule: s.matricule,
        firstName: s.firstName,
        lastName: s.lastName,
        sex: s.sex ?? null,
        birthDate: s.birthDate ? s.birthDate.toISOString().slice(0, 10) : null,
        birthPlace: s.birthPlace ?? null,
        photoUrl: s.photoUrl ?? null,
      },
      academicYear: year.name,
      classroomName: enrollment.classroom.name,
      enrollmentStatus: enrollment.status,
      enrolledAt: enrollment.enrolledAt.toISOString().slice(0, 10),
      issuerName: issuer ? `${issuer.firstName} ${issuer.lastName}`.trim() : null,
    },
  };
}

// ---------- Émission ----------

/**
 * Émet un document administratif. La numérotation est atomique :
 * verrou advisory par école dans la transaction + contrainte unique —
 * deux émissions simultanées obtiennent des numéros distincts.
 */
export async function issueAdministrativeDocument(
  ctx: SchoolCtx,
  input: { studentId: string; type: AdminDocumentType; academicYearId?: string },
): Promise<AdminDocsResult<{ id: string; number: string }>> {
  if (!(await hasPerm(ctx, "administrative-docs.issue"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const built = await buildPayload(ctx, input);
  if (!built) return { ok: false, error: "NOT_ENROLLED" };

  const publicCode = randomBytes(24).toString("base64url");
  const yearTag = String(new Date().getUTCFullYear());

  try {
    const row = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"admindoc:" + ctx.schoolId}))`;
      const seq = await tx.administrativeDocument.count({
        where: { schoolId: ctx.schoolId, number: { startsWith: `DOC-${yearTag}-` } },
      });
      const number = `DOC-${yearTag}-${String(seq + 1).padStart(5, "0")}`;
      return tx.administrativeDocument.create({
        data: {
          schoolId: ctx.schoolId,
          type: input.type,
          number,
          studentId: input.studentId,
          academicYearId: built.academicYearId,
          publicCode,
          payload: built.payload as object,
          issuedById: ctx.userId,
        },
        select: { id: true, number: true },
      });
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "admin_doc.issued",
      entity: "AdministrativeDocument",
      entityId: row.id,
      metadata: { type: input.type, number: row.number, studentId: input.studentId },
    });
    return { ok: true, data: row };
  } catch {
    return { ok: false, error: "INVALID_STATE" };
  }
}

// ---------- Consultation ----------

export async function listAdministrativeDocuments(
  ctx: SchoolCtx,
  filters: { studentId?: string; type?: AdminDocumentType; status?: AdminDocumentStatus } = {},
) {
  if (!(await canReadAdminDocs(ctx))) return [];
  return prisma.administrativeDocument.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.studentId ? { studentId: filters.studentId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    include: {
      student: { select: { matricule: true, firstName: true, lastName: true } },
      academicYear: { select: { name: true } },
    },
    orderBy: { issuedAt: "desc" },
    take: 500,
  });
}

/**
 * Document pour téléchargement administratif (ISSUED ou REVOKED — le
 * rendu affiche la révocation). Le snapshot est revérifié sous
 * `schoolId` — jamais d'accès croisé.
 */
export async function getAdminDocForDownload(ctx: SchoolCtx, id: string) {
  if (!(await canReadAdminDocs(ctx))) return null;
  const doc = await prisma.administrativeDocument.findFirst({
    where: { id, schoolId: ctx.schoolId },
  });
  if (!doc) return null;
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "admin_doc.download",
    entity: "AdministrativeDocument",
    entityId: doc.id,
    metadata: { type: doc.type, number: doc.number },
  });
  return doc;
}

/**
 * Document pour téléchargement parent : rattachement vérifié à
 * l'élève + document ISSUED uniquement (un document révoqué n'est
 * jamais remis au parent — NOT_FOUND, pas de fuite d'état).
 */
export async function getAdminDocForParent(ctx: SchoolCtx, id: string) {
  const doc = await prisma.administrativeDocument.findFirst({
    where: { id, schoolId: ctx.schoolId, status: "ISSUED" },
    select: { id: true, studentId: true, type: true, number: true, payload: true, publicCode: true, status: true, issuedAt: true },
  });
  if (!doc) return null;
  if (!(await verifyChildAccess(ctx, doc.studentId))) return null;
  return doc;
}

/**
 * Documents ISSUED visibles par le parent — `studentId` obligatoire
 * (onglet par enfant) : le rattachement est vérifié AVANT toute
 * lecture, jamais de filtrage a posteriori sur l'ensemble de l'école.
 */
export async function listAdminDocsForParent(ctx: SchoolCtx, studentId: string) {
  if (!(await verifyChildAccess(ctx, studentId))) return [];
  return prisma.administrativeDocument.findMany({
    where: { schoolId: ctx.schoolId, studentId, status: "ISSUED" },
    select: {
      id: true, type: true, number: true, issuedAt: true,
      academicYear: { select: { name: true } },
    },
    orderBy: { issuedAt: "desc" },
    take: 100,
  });
}

// ---------- Révocation / réémission ----------

export async function revokeAdministrativeDocument(
  ctx: SchoolCtx,
  id: string,
  input: { reason: string },
): Promise<AdminDocsResult> {
  if (!(await hasPerm(ctx, "administrative-docs.issue"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  if (!input.reason.trim()) return { ok: false, error: "INVALID_INPUT" };
  const updated = await prisma.administrativeDocument.updateMany({
    where: { id, schoolId: ctx.schoolId, status: "ISSUED" },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
      revokedById: ctx.userId,
      revokeReason: input.reason.trim(),
    },
  });
  if (updated.count === 0) return { ok: false, error: "INVALID_STATE" };
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "admin_doc.revoked",
    entity: "AdministrativeDocument",
    entityId: id,
    metadata: { reason: input.reason.trim() },
  });
  return { ok: true, data: undefined };
}

/**
 * Réémission : nouveau document (nouveau numéro, nouveau code public,
 * snapshot recalculé) — l'ancien est révoqué et pointe vers son
 * remplaçant. La chaîne reste traçable.
 */
export async function reissueAdministrativeDocument(
  ctx: SchoolCtx,
  id: string,
): Promise<AdminDocsResult<{ id: string; number: string }>> {
  if (!(await hasPerm(ctx, "administrative-docs.issue"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const old = await prisma.administrativeDocument.findFirst({
    where: { id, schoolId: ctx.schoolId, status: "ISSUED" },
    select: { id: true, type: true, studentId: true, academicYearId: true, number: true },
  });
  if (!old) return { ok: false, error: "INVALID_STATE" };
  const issued = await issueAdministrativeDocument(ctx, {
    studentId: old.studentId,
    type: old.type,
    academicYearId: old.academicYearId,
  });
  if (!issued.ok) return issued;
  await prisma.administrativeDocument.updateMany({
    where: { id: old.id, status: "ISSUED" },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
      revokedById: ctx.userId,
      revokeReason: `Remplacé par ${issued.data.number}`,
      replacedById: issued.data.id,
    },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "admin_doc.reissued",
    entity: "AdministrativeDocument",
    entityId: issued.data.id,
    metadata: { previousId: old.id, previousNumber: old.number },
  });
  return issued;
}

// ---------- Vérification publique ----------

export type PublicVerification =
  | {
      status: "VALID" | "REVOKED";
      typeLabel: string;
      number: string;
      schoolName: string;
      studentName: string;
      academicYear: string;
      issuedAt: string;
    }
  | { status: "UNKNOWN" };

/**
 * Vérification publique par code opaque — sans session. Réponse
 * volontairement limitée : statut + informations présentes sur le
 * document papier (type, numéro, école, élève, année, date). Aucun
 * identifiant interne, aucune coordonnée, aucun état d'avancement.
 */
export async function verifyPublicDocument(code: string): Promise<PublicVerification> {
  const clean = (code ?? "").trim();
  if (!clean || clean.length > 128) return { status: "UNKNOWN" };
  const doc = await prisma.administrativeDocument.findUnique({
    where: { publicCode: clean },
    select: {
      type: true, number: true, status: true, issuedAt: true,
      school: { select: { name: true } },
      student: { select: { firstName: true, lastName: true } },
      academicYear: { select: { name: true } },
    },
  });
  if (!doc) return { status: "UNKNOWN" };
  return {
    status: doc.status === "ISSUED" ? "VALID" : "REVOKED",
    typeLabel: TYPE_LABELS[doc.type],
    number: doc.number,
    schoolName: doc.school.name,
    studentName: `${doc.student.firstName} ${doc.student.lastName}`,
    academicYear: doc.academicYear.name,
    issuedAt: doc.issuedAt.toISOString().slice(0, 10),
  };
}
