import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { createStudent } from "@/lib/services/students";
import { enrollStudent } from "@/lib/services/enrollments";
import { findPotentialDuplicates } from "@/lib/services/registration";
import { generateStudentCharges } from "@/lib/services/finance/accounts";
import {
  inviteGuardianAccount,
  inviteStudentAccount,
} from "@/lib/services/portal/accounts";
import { requiredDocsOf } from "@/lib/services/admissions";
import type { GuardianRelation } from "@prisma/client";

/**
 * G2-D — Conversion d'une candidature admise en inscription définitive.
 *
 * Autorisations (toutes vérifiées dans le service, jamais dans l'UI) :
 *  - `admissions.convert` : porte le droit métier de conversion.
 *  - `enrollment.create`  : droit d'inscrire un élève.
 *  - `student.create`     : exigé en plus lorsque la fiche élève est créée.
 *  - `guardian.manage`   : exigé en plus lorsqu'un responsable est créé
 *    ou rattaché dans ce parcours.
 * Aucune permission financière n'est exigée : la génération des créances
 * est intégrée au parcours autorisé (même règle que registerStudent).
 *
 * Transaction : verrous advisory (dossier puis classe) → une seule
 * conversion par candidature et aucune surcharge de classe en concurrence.
 * Les créances sont générées APRÈS commit (contrainte unique + P2002 →
 * 25P02 annulerait la transaction — même pattern que registerStudent) :
 * un échec est signalé via `chargesError` et peut être relancé en
 * rejouant la conversion (idempotente).
 *
 * Jamais dans ce parcours : aucun paiement, aucune déduction automatique
 * des frais de candidature (`campaign.applicationFee` est indicatif,
 * réglé au guichet), aucun envoi SMS/WhatsApp/email — l'invitation
 * portail produit un jeton remis à l'agent pour transmission manuelle.
 */

export type ConversionError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_STATE"
  | "CONDITIONS_PENDING"
  | "MISSING_DOCS"
  | "DUPLICATE_AMBIGUOUS"
  | "GUARDIAN_AMBIGUOUS"
  | "CLASSROOM_FULL"
  | "MATRICULE_TAKEN"
  | "ALREADY_ENROLLED"
  | "STUDENT_INACTIVE"
  | "YEAR_CLOSED"
  | "CLASSROOM_ARCHIVED"
  | "CROSS_YEAR"
  | "LIMIT_REACHED"
  | "CONCURRENT"
  | "CREATE_FAILED";

export type ConversionResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: ConversionError };

type SchoolCtx = { userId: string; schoolId: string };

async function hasPerm(ctx: SchoolCtx, key: string) {
  return userHasSchoolPermission({
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    permissionKey: key,
  });
}

const GUARDIAN_RELATION_MAP: Record<string, GuardianRelation> = {
  père: "FATHER",
  pere: "FATHER",
  father: "FATHER",
  mère: "MOTHER",
  mere: "MOTHER",
  mother: "MOTHER",
};

/** Libre texte du portail → enum métier. Valeur inconnue → GUARDIAN. */
function toGuardianRelation(raw?: string | null): GuardianRelation {
  const key = (raw ?? "").trim().toLowerCase();
  return GUARDIAN_RELATION_MAP[key] ?? "GUARDIAN";
}

// ---------- Prévisualisation (lecture seule) ----------

/**
 * Rapport de conversion pour la fiche dossier : éligibilité, blocages,
 * doublons élève, responsables candidats, classes de l'année cible avec
 * places réelles, et estimation des créances pour la classe choisie.
 * `classroomId` optionnel — défaut : classe souhaitée par le candidat.
 */
export async function previewConversion(
  ctx: SchoolCtx,
  applicationId: string,
  classroomId?: string,
) {
  if (!(await hasPerm(ctx, "admissions.convert"))) return null;

  const app = await prisma.admissionApplication.findFirst({
    where: { id: applicationId, schoolId: ctx.schoolId },
    include: {
      campaign: {
        select: {
          id: true,
          name: true,
          academicYearId: true,
          applicationFee: true,
          requiredDocs: true,
          academicYear: { select: { id: true, name: true, status: true } },
        },
      },
      targetLevel: { select: { id: true, name: true } },
      targetClassroom: { select: { id: true, name: true } },
    },
  });
  if (!app) return null;

  const yearId = app.campaign.academicYearId;

  const [docs, duplicates, guardianCandidates, classrooms] =
    await Promise.all([
      prisma.document.findMany({
        where: { ownerType: "ADMISSION", ownerId: app.id, status: "ACTIVE" },
        select: { label: true, category: true },
      }),
      findPotentialDuplicates(ctx, {
        lastName: app.candidateLastName,
        firstName: app.candidateFirstName,
        birthDate: app.birthDate?.toISOString(),
      }),
      app.selfApplicant
        ? Promise.resolve([])
        : prisma.guardian.findMany({
            where: {
              schoolId: ctx.schoolId,
              status: "ACTIVE",
              OR: [
                { phone: app.guardianPhone },
                ...(app.guardianEmail
                  ? [{ email: app.guardianEmail.toLowerCase() }]
                  : []),
              ],
            },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
              _count: { select: { students: true } },
            },
            take: 10,
          }),
      prisma.classroom.findMany({
        where: {
          schoolId: ctx.schoolId,
          academicYearId: yearId,
          status: "ACTIVE",
        },
        select: {
          id: true,
          name: true,
          capacity: true,
          levelId: true,
          level: { select: { name: true } },
          _count: {
            select: { enrollments: { where: { status: "ENROLLED" } } },
          },
        },
        orderBy: [{ level: { order: "asc" } }, { name: "asc" }],
      }),
    ]);

  const missingDocs = requiredDocsOf(
    app.campaign as unknown as Parameters<typeof requiredDocsOf>[0],
  )
    .filter((d) => d.required !== false)
    .filter(
      (rd) =>
        !docs.some((d) => d.label === rd.key || d.label === rd.label) &&
        !docs.some((d) => d.category === rd.category && d.label === rd.key),
    )
    .map((d) => d.label);

  // Classe présélectionnée : paramètre > souhait candidat > première classe.
  const selectedId =
    classroomId ?? app.targetClassroomId ?? classrooms[0]?.id ?? null;
  const selected = classrooms.find((c) => c.id === selectedId) ?? null;
  const selectedLevelId = selected?.levelId ?? app.targetLevel?.id ?? null;

  const tariffs = selected
    ? await prisma.feeTariff.findMany({
        where: {
          schoolId: ctx.schoolId,
          academicYearId: yearId,
          status: "ACTIVE",
          mandatory: true,
          OR: [{ classroomId: selected.id }, { classroomId: null }],
          AND: [
            {
              OR: [{ levelId: null }, { levelId: selectedLevelId ?? "" }],
            },
          ],
        },
        select: {
          id: true,
          amount: true,
          installmentCount: true,
          category: { select: { label: true } },
        },
        orderBy: { category: { label: "asc" } },
      })
    : [];

  const conditionsPending =
    app.status === "CONDITIONALLY_ACCEPTED" && !app.conditionsLiftedAt;
  const eligible =
    app.status === "ACCEPTED" ||
    (app.status === "CONDITIONALLY_ACCEPTED" && !!app.conditionsLiftedAt);

  const blockers: string[] = [];
  if (!["ACCEPTED", "CONDITIONALLY_ACCEPTED", "CONVERTED"].includes(app.status))
    blockers.push("statut_non_admis");
  if (conditionsPending) blockers.push("conditions_non_levees");
  if (app.status !== "CONVERTED") {
    if (missingDocs.length) blockers.push("pieces_manquantes");
    if (app.campaign.academicYear.status === "CLOSED")
      blockers.push("annee_cloturee");
    if (duplicates.length) blockers.push("doublons_a_arbitrer");
    if (guardianCandidates.length) blockers.push("responsable_a_arbitrer");
    if (selected?.capacity != null && selected._count.enrollments >= selected.capacity)
      blockers.push("classe_complete");
  }

  return {
    application: {
      id: app.id,
      fileNumber: app.fileNumber,
      status: app.status,
      selfApplicant: app.selfApplicant,
      conditionsLiftedAt: app.conditionsLiftedAt,
      decisionConditions: app.decisionConditions,
      studentId: app.studentId,
      guardianId: app.guardianId,
      enrollmentId: app.enrollmentId,
      convertedAt: app.convertedAt,
    },
    eligible,
    blockers,
    campaign: {
      id: app.campaign.id,
      name: app.campaign.name,
      academicYear: app.campaign.academicYear,
      applicationFee: app.campaign.applicationFee,
    },
    candidate: {
      firstName: app.candidateFirstName,
      lastName: app.candidateLastName,
      birthDate: app.birthDate,
    },
    guardianInfo: app.selfApplicant
      ? null
      : {
          firstName: app.guardianFirstName,
          lastName: app.guardianLastName,
          relation: app.guardianRelation,
          phone: app.guardianPhone,
          email: app.guardianEmail,
        },
    missingDocs,
    duplicates: duplicates.map((d) => ({
      id: d.id,
      matricule: d.matricule,
      firstName: d.firstName,
      lastName: d.lastName,
      birthDate: d.birthDate,
      status: d.status,
    })),
    guardianCandidates: guardianCandidates.map((g) => ({
      id: g.id,
      firstName: g.firstName,
      lastName: g.lastName,
      phone: g.phone,
      email: g.email,
      studentCount: g._count.students,
    })),
    classrooms: classrooms.map((c) => ({
      id: c.id,
      name: c.name,
      levelName: c.level.name,
      matchesTarget: c.levelId === app.targetLevel?.id,
      capacity: c.capacity,
      enrolled: c._count.enrollments,
      seatsLeft: c.capacity == null ? null : c.capacity - c._count.enrollments,
      selected: c.id === selectedId,
    })),
    chargesPreview: tariffs.map((t) => ({
      category: t.category.label,
      amount: t.amount,
      installments: t.installmentCount,
    })),
  };
}

// ---------- Levée des conditions ----------

/**
 * Lève formellement les conditions d'une admission conditionnelle
 * (`admissions.decide`). Prérequis à la conversion : une candidature
 * CONDITIONALLY_ACCEPTED ne devient convertible qu'après cet acte
 * motivé et audité.
 */
export async function liftConditions(
  ctx: SchoolCtx,
  applicationId: string,
  note?: string,
): Promise<ConversionResult> {
  if (!(await hasPerm(ctx, "admissions.decide"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const app = await prisma.admissionApplication.findFirst({
    where: { id: applicationId, schoolId: ctx.schoolId },
    select: { id: true, status: true, fileNumber: true, conditionsLiftedAt: true },
  });
  if (!app) return { ok: false, error: "NOT_FOUND" };
  if (
    app.status !== "CONDITIONALLY_ACCEPTED" ||
    app.conditionsLiftedAt
  ) {
    return { ok: false, error: "INVALID_STATE" };
  }

  await prisma.admissionApplication.update({
    where: { id: app.id },
    data: {
      conditionsLiftedAt: new Date(),
      conditionsLiftedById: ctx.userId,
    },
    select: { id: true },
  });
  await prisma.admissionEvent.create({
    data: {
      schoolId: ctx.schoolId,
      applicationId: app.id,
      fromStatus: "CONDITIONALLY_ACCEPTED",
      toStatus: "CONDITIONALLY_ACCEPTED",
      actorId: ctx.userId,
      actorLabel: "levée de conditions",
      note: note?.trim().slice(0, 2000) || "Conditions d'admission levées",
    },
  });
  await prisma.admissionMessage.create({
    data: {
      schoolId: ctx.schoolId,
      applicationId: app.id,
      kind: "CONDITIONS_LIFTED",
      body: "Les conditions de votre admission sont levées — le dossier peut être converti en inscription.",
      createdById: ctx.userId,
      visibleToApplicant: true,
    },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "admissions.conditions_lift",
    entity: "AdmissionApplication",
    entityId: app.id,
    metadata: { fileNumber: app.fileNumber },
  });
  return { ok: true, result: undefined };
}

// ---------- Conversion ----------

export type ConvertInput = {
  applicationId: string;
  /** Classe cible réelle (année de la campagne). */
  classroomId: string;
  /** Rattacher à un élève existant (vérifié humainement). */
  studentId?: string;
  /** Matricule du nouvel élève — requis si studentId absent. */
  matricule?: string;
  /** Confirme la création malgré les doublons signalés. */
  acknowledgeDuplicates?: boolean;
  /** Responsable existant à rattacher. */
  guardianId?: string;
  /** Forcer la création d'un nouveau responsable. */
  createGuardian?: boolean;
  /** Préparer l'invitation portail (parent, ou élève si majeur). */
  inviteAccount?: boolean;
};

export type ConvertedPayload = {
  alreadyConverted: boolean;
  studentId: string;
  guardianId: string | null;
  enrollmentId: string | null;
  academicYearId: string;
  charges: { created: number; existing: number; skipped: number };
  noTariffs: boolean;
  /** Code si la génération post-commit a échoué (inscription conservée,
   *  rejouable — la conversion reste idempotente). */
  chargesError: string | null;
  /** Jeton d'invitation portail, remis une fois pour transmission manuelle. */
  inviteToken: string | null;
  inviteError: string | null;
};

/** Erreur métier transportée hors de la transaction Prisma. */
class ConversionAbort extends Error {
  constructor(public readonly code: ConversionError) {
    super(code);
    this.name = "ConversionAbort";
  }
}

export async function convertApplication(
  ctx: SchoolCtx,
  input: ConvertInput,
): Promise<ConversionResult<ConvertedPayload>> {
  // Composition des habilitations : convert + inscription ; les droits
  // fins supplémentaires dépendent des créations demandées.
  if (
    !(await hasPerm(ctx, "admissions.convert")) ||
    !(await hasPerm(ctx, "enrollment.create"))
  ) {
    return { ok: false, error: "FORBIDDEN" };
  }

  const app = await prisma.admissionApplication.findFirst({
    where: { id: input.applicationId, schoolId: ctx.schoolId },
    include: {
      campaign: {
        select: {
          id: true,
          academicYearId: true,
          requiredDocs: true,
          academicYear: { select: { status: true } },
        },
      },
    },
  });
  if (!app) return { ok: false, error: "NOT_FOUND" };

  const yearId = app.campaign.academicYearId;

  // Rejeu : conversion déjà faite → on retourne les références existantes
  // et on complète les créances si besoin (idempotent).
  if (app.status === "CONVERTED") {
    return finishConversion(ctx, {
      alreadyConverted: true,
      studentId: app.studentId!,
      guardianId: app.guardianId,
      enrollmentId: app.enrollmentId,
      academicYearId: yearId,
      inviteAccount: false,
      selfApplicant: app.selfApplicant,
    });
  }

  // Éligibilité : admis, ou conditionnel avec conditions levées.
  if (app.status === "CONDITIONALLY_ACCEPTED" && !app.conditionsLiftedAt) {
    return { ok: false, error: "CONDITIONS_PENDING" };
  }
  if (app.status !== "ACCEPTED" && app.status !== "CONDITIONALLY_ACCEPTED") {
    return { ok: false, error: "INVALID_STATE" };
  }
  if (app.campaign.academicYear.status === "CLOSED") {
    return { ok: false, error: "YEAR_CLOSED" };
  }

  const createStudentNeeded = !input.studentId;
  const createGuardianNeeded =
    !app.selfApplicant &&
    !input.guardianId &&
    !!(app.guardianFirstName || app.guardianLastName || app.guardianPhone);

  if (createStudentNeeded) {
    if (!(await hasPerm(ctx, "student.create"))) {
      return { ok: false, error: "FORBIDDEN" };
    }
    if (!input.matricule?.trim()) {
      return { ok: false, error: "INVALID_INPUT" };
    }
  }

  if (createGuardianNeeded || input.guardianId) {
    if (!(await hasPerm(ctx, "guardian.manage"))) {
      return { ok: false, error: "FORBIDDEN" };
    }
  }
  if (!app.selfApplicant && !input.guardianId && !input.createGuardian) {
    if (!app.guardianLastName?.trim()) {
      return { ok: false, error: "INVALID_INPUT" };
    }
  }
  if (input.guardianId && input.createGuardian) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  // Pièces obligatoires : clé ou libellé de la pièce exigée.
  const required = requiredDocsOf(
    app.campaign as unknown as Parameters<typeof requiredDocsOf>[0],
  ).filter((d) => d.required !== false);
  if (required.length) {
    const docs = await prisma.document.findMany({
      where: { ownerType: "ADMISSION", ownerId: app.id, status: "ACTIVE" },
      select: { label: true, category: true },
    });
    const missing = required.filter(
      (rd) =>
        !docs.some((d) => d.label === rd.key || d.label === rd.label),
    );
    if (missing.length) return { ok: false, error: "MISSING_DOCS" };
  }

  let core: {
    studentId: string;
    guardianId: string | null;
    enrollmentId: string | null;
    already: boolean;
  };
  try {
    core = await prisma.$transaction(async (tx) => {
      // Verrous : sérialise la conversion du dossier, puis l'occupation
      // de la classe cible (capacité réelle fiable en concurrence).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"adm-cv:" + app.id}))`;
      const fresh = await tx.admissionApplication.findUniqueOrThrow({
        where: { id: app.id },
        select: {
          status: true,
          studentId: true,
          guardianId: true,
          enrollmentId: true,
        },
      });
      // Conversion déjà gagnée par une transaction concurrente → rejeu
      // idempotent : mêmes références, aucune création supplémentaire.
      if (fresh.status === "CONVERTED") {
        return {
          studentId: fresh.studentId!,
          guardianId: fresh.guardianId,
          enrollmentId: fresh.enrollmentId,
          already: true,
        };
      }
      if (!["ACCEPTED", "CONDITIONALLY_ACCEPTED"].includes(fresh.status)) {
        throw new ConversionAbort("INVALID_STATE");
      }
      if (
        fresh.status === "CONDITIONALLY_ACCEPTED" &&
        !app.conditionsLiftedAt
      ) {
        throw new ConversionAbort("CONDITIONS_PENDING");
      }

      // Contrôles d'ambiguïté sous le verrou : une conversion concurrente
      // ne peut plus fausser la lecture (le rejeu ci-dessus l'a déjà
      // interceptée), et tout doublon réel reste bloquant.
      if (!input.studentId) {
        const dups = await findPotentialDuplicates(ctx, {
          lastName: app.candidateLastName,
          firstName: app.candidateFirstName,
          birthDate: app.birthDate?.toISOString(),
        });
        if (dups.length && !input.acknowledgeDuplicates) {
          throw new ConversionAbort("DUPLICATE_AMBIGUOUS");
        }
      }
      if (!app.selfApplicant && !input.guardianId && !input.createGuardian) {
        const candidates = await tx.guardian.count({
          where: {
            schoolId: ctx.schoolId,
            status: "ACTIVE",
            OR: [
              { phone: app.guardianPhone },
              ...(app.guardianEmail ? [{ email: app.guardianEmail.toLowerCase() }] : []),
            ],
          },
        });
        if (candidates > 0) throw new ConversionAbort("GUARDIAN_AMBIGUOUS");
      }

      const classroom = await tx.classroom.findFirst({
        where: { id: input.classroomId, schoolId: ctx.schoolId },
        select: { id: true, academicYearId: true, status: true, capacity: true },
      });
      if (!classroom) throw new ConversionAbort("NOT_FOUND");
      if (classroom.status === "ARCHIVED") {
        throw new ConversionAbort("CLASSROOM_ARCHIVED");
      }
      if (classroom.academicYearId !== yearId) {
        throw new ConversionAbort("CROSS_YEAR");
      }

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cls:" + classroom.id}))`;
      if (classroom.capacity != null) {
        const enrolled = await tx.enrollment.count({
          where: {
            schoolId: ctx.schoolId,
            classroomId: classroom.id,
            status: "ENROLLED",
          },
        });
        if (enrolled >= classroom.capacity) {
          throw new ConversionAbort("CLASSROOM_FULL");
        }
      }

      // Élève : existant validé, ou création dans la transaction.
      let studentId: string;
      if (input.studentId) {
        const st = await tx.student.findFirst({
          where: { id: input.studentId, schoolId: ctx.schoolId },
          select: { id: true, status: true },
        });
        if (!st) throw new ConversionAbort("NOT_FOUND");
        if (st.status !== "ACTIVE") {
          throw new ConversionAbort("STUDENT_INACTIVE");
        }
        studentId = st.id;
      } else {
        const created = await createStudent(
          ctx,
          {
            matricule: input.matricule!,
            firstName: app.candidateFirstName,
            lastName: app.candidateLastName,
            sex: app.sex ?? undefined,
            birthDate: app.birthDate?.toISOString().slice(0, 10),
            birthPlace: app.birthPlace ?? undefined,
            phone: app.selfApplicant ? app.guardianPhone : undefined,
            email: app.selfApplicant ? (app.guardianEmail ?? undefined) : undefined,
          },
          tx,
        );
        if (!created.ok) {
          throw new ConversionAbort(
            created.error === "MATRICULE_TAKEN"
              ? "MATRICULE_TAKEN"
              : "CREATE_FAILED",
          );
        }
        studentId = created.result.id;
      }

      // Responsable : rattachement contrôlé ou création, puis lien.
      let guardianId: string | null = null;
      if (!app.selfApplicant) {
        if (input.guardianId) {
          const g = await tx.guardian.findFirst({
            where: { id: input.guardianId, schoolId: ctx.schoolId },
            select: { id: true, status: true },
          });
          if (!g) throw new ConversionAbort("NOT_FOUND");
          guardianId = g.id;
        } else {
          const g = await tx.guardian.create({
            data: {
              schoolId: ctx.schoolId,
              firstName: app.guardianFirstName?.trim() || "—",
              lastName: app.guardianLastName!.trim(),
              phone: app.guardianPhone,
              email: app.guardianEmail?.toLowerCase() || null,
              address: app.guardianAddress || null,
            },
            select: { id: true },
          });
          guardianId = g.id;
          await logAudit({
            actorId: ctx.userId,
            schoolId: ctx.schoolId,
            action: "guardian.create",
            entity: "Guardian",
            entityId: g.id,
            metadata: { via: "admission", applicationId: app.id },
            tx,
          });
        }
        // Lien élève↔responsable : idempotent sur le triplet unique.
        const relation = toGuardianRelation(app.guardianRelation);
        const link = await tx.studentGuardian.findFirst({
          where: { studentId, guardianId, relation },
          select: { id: true },
        });
        if (!link) {
          await tx.studentGuardian.create({
            data: { schoolId: ctx.schoolId, studentId, guardianId, relation },
            select: { id: true },
          });
        }
      }

      const enrolled = await enrollStudent(
        ctx,
        { studentId, classroomId: classroom.id, academicYearId: yearId },
        tx,
      );
      if (!enrolled.ok) {
        const map: Record<string, ConversionError> = {
          ALREADY_ENROLLED: "ALREADY_ENROLLED",
          YEAR_CLOSED: "YEAR_CLOSED",
          CLASSROOM_ARCHIVED: "CLASSROOM_ARCHIVED",
          CROSS_YEAR: "CROSS_YEAR",
          STUDENT_INACTIVE: "STUDENT_INACTIVE",
          LIMIT_REACHED: "LIMIT_REACHED",
          NOT_FOUND: "NOT_FOUND",
          NO_CURRENT_YEAR: "YEAR_CLOSED",
          INVALID_INPUT: "INVALID_INPUT",
        };
        throw new ConversionAbort(map[enrolled.error] ?? "CREATE_FAILED");
      }

      // Bascule bornée : une seule conversion par candidature.
      const upd = await tx.admissionApplication.updateMany({
        where: {
          id: app.id,
          status: { in: ["ACCEPTED", "CONDITIONALLY_ACCEPTED"] },
        },
        data: {
          status: "CONVERTED",
          studentId,
          guardianId,
          enrollmentId: enrolled.result.id,
          convertedAt: new Date(),
          convertedById: ctx.userId,
        },
      });
      if (upd.count === 0) throw new ConversionAbort("CONCURRENT");

      await tx.admissionEvent.create({
        data: {
          schoolId: ctx.schoolId,
          applicationId: app.id,
          fromStatus: fresh.status,
          toStatus: "CONVERTED",
          actorId: ctx.userId,
          actorLabel: "conversion",
          note: `Inscription créée (classe ${input.classroomId})`,
        },
      });
      await tx.admissionMessage.create({
        data: {
          schoolId: ctx.schoolId,
          applicationId: app.id,
          kind: "CONVERSION",
          body: "Votre admission est confirmée : le dossier a été converti en inscription définitive.",
          createdById: ctx.userId,
          visibleToApplicant: true,
        },
      });
      await logAudit({
        actorId: ctx.userId,
        schoolId: ctx.schoolId,
        action: "admissions.convert",
        entity: "AdmissionApplication",
        entityId: app.id,
        metadata: {
          fileNumber: app.fileNumber,
          studentId,
          guardianId,
          enrollmentId: enrolled.result.id,
          studentReused: !!input.studentId,
          guardianReused: !!input.guardianId,
          duplicatesAcknowledged: !!input.acknowledgeDuplicates,
        },
        tx,
      });

      return {
        studentId,
        guardianId,
        enrollmentId: enrolled.result.id,
        already: false,
      };
    });
  } catch (e) {
    if (e instanceof ConversionAbort) {
      return { ok: false, error: e.code };
    }
    return { ok: false, error: "CREATE_FAILED" };
  }

  return finishConversion(ctx, {
    alreadyConverted: core.already,
    studentId: core.studentId,
    guardianId: core.guardianId,
    enrollmentId: core.enrollmentId,
    academicYearId: yearId,
    inviteAccount: !!input.inviteAccount && !core.already,
    selfApplicant: app.selfApplicant,
  });
}

/**
 * Prépare l'accès portail après conversion (`admissions.convert`) :
 * parent pour un dossier avec responsable, élève pour un candidat
 * majeur. Aucun envoi externe — le jeton est retourné pour être remis
 * manuellement à la famille par l'établissement.
 */
export async function inviteConvertedAccount(
  ctx: SchoolCtx,
  applicationId: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (!(await hasPerm(ctx, "admissions.convert"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const app = await prisma.admissionApplication.findFirst({
    where: { id: applicationId, schoolId: ctx.schoolId },
    select: {
      status: true,
      selfApplicant: true,
      studentId: true,
      guardianId: true,
    },
  });
  if (!app || app.status !== "CONVERTED" || !app.studentId) {
    return { ok: false, error: "INVALID_STATE" };
  }
  if (!app.selfApplicant && app.guardianId) {
    const res = await inviteGuardianAccount(ctx, { guardianId: app.guardianId });
    return res.ok
      ? { ok: true, token: res.result.token }
      : { ok: false, error: res.error };
  }
  const res = await inviteStudentAccount(ctx, { studentId: app.studentId });
  return res.ok
    ? { ok: true, token: res.result.token }
    : { ok: false, error: res.error };
}

/** Post-commit : créances (idempotent) + invitation portail facultative. */
async function finishConversion(
  ctx: SchoolCtx,
  args: {
    alreadyConverted: boolean;
    studentId: string;
    guardianId: string | null;
    enrollmentId: string | null;
    academicYearId: string;
    inviteAccount: boolean;
    selfApplicant: boolean;
  },
): Promise<ConversionResult<ConvertedPayload>> {
  const charges = await generateStudentCharges(ctx, {
    studentId: args.studentId,
    academicYearId: args.academicYearId,
  });

  let inviteToken: string | null = null;
  let inviteError: string | null = null;
  if (args.inviteAccount) {
    const inv =
      args.selfApplicant || !args.guardianId
        ? await inviteStudentAccount(ctx, { studentId: args.studentId })
        : await inviteGuardianAccount(ctx, { guardianId: args.guardianId });
    if (inv.ok) inviteToken = inv.result.token;
    else inviteError = inv.error;
  }

  return {
    ok: true,
    result: {
      alreadyConverted: args.alreadyConverted,
      studentId: args.studentId,
      guardianId: args.guardianId,
      enrollmentId: args.enrollmentId,
      academicYearId: args.academicYearId,
      charges: charges.ok
        ? {
            created: charges.result.created,
            existing: charges.result.existing,
            skipped: charges.result.skipped,
          }
        : { created: 0, existing: 0, skipped: 0 },
      noTariffs: charges.ok ? charges.result.tariffs === 0 : false,
      chargesError: charges.ok ? null : charges.error,
      inviteToken,
      inviteError,
    },
  };
}
