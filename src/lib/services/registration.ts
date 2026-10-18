import { prisma } from "@/lib/db/prisma";
import { createStudent, type StudentInput } from "@/lib/services/students";
import { enrollStudent } from "@/lib/services/enrollments";
import { generateStudentCharges } from "@/lib/services/finance/accounts";
import type { EnrollmentsError } from "@/lib/services/enrollments";
import type { StudentsError } from "@/lib/services/students";

type SchoolCtx = { userId: string; schoolId: string };

export type RegistrationError =
  | EnrollmentsError
  | StudentsError
  | "NOT_ENROLLED";

export type RegistrationResult =
  | {
      ok: true;
      result: {
        studentId: string;
        enrollmentId: string | null;
        /** true si l'élève était déjà ENROLLED sur cette année. */
        alreadyEnrolled: boolean;
        charges: { created: number; existing: number; skipped: number };
        /** true si aucun tarif applicable n'est configuré. */
        noTariffs: boolean;
        /** Code d'erreur si la génération des créances a échoué
         *  (l'inscription administrative est conservée). */
        chargesError: string | null;
        academicYearId: string;
      };
    }
  | { ok: false; error: RegistrationError };

/** Élèves potentiellement déjà enregistrés (alerte, pas blocage — homonymes possibles). */
export async function findPotentialDuplicates(
  ctx: SchoolCtx,
  input: { lastName: string; firstName: string; birthDate?: string },
) {
  const lastName = input.lastName.trim();
  const firstName = input.firstName.trim();
  if (!lastName || !firstName) return [];

  const birthDate =
    input.birthDate && !Number.isNaN(new Date(input.birthDate).getTime())
      ? new Date(input.birthDate)
      : null;

  return prisma.student.findMany({
    where: {
      schoolId: ctx.schoolId,
      lastName: { equals: lastName, mode: "insensitive" },
      firstName: { equals: firstName, mode: "insensitive" },
      ...(birthDate ? { birthDate } : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 10,
    select: {
      id: true,
      matricule: true,
      firstName: true,
      lastName: true,
      birthDate: true,
      status: true,
    },
  });
}

/**
 * Orchestration « guichet inscription » :
 *   (création facultative de la fiche) → inscription, dans UNE transaction,
 * puis créances de l'élève après commit.
 *
 * La génération des créances s'appuie sur la contrainte unique
 * (studentId, academicYearId, categoryId) via `create` + P2002 — or en
 * PostgreSQL un P2002 annule la transaction (25P02) : elle doit donc
 * s'exécuter APRÈS le commit de l'inscription. En cas d'échec des
 * créances, l'inscription administrative est conservée (`chargesError`).
 *
 * Le paiement est volontairement hors périmètre (facultatif, étape
 * suivante). Aucun modèle ni dossier financier physique créé.
 */
export async function registerStudent(
  ctx: SchoolCtx,
  input: {
    studentId?: string;
    student?: StudentInput;
    classroomId: string;
    academicYearId?: string;
  },
): Promise<RegistrationResult> {
  if (!input.studentId && !input.student) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const academicYearId =
    input.academicYearId ??
    (
      await prisma.academicYear.findFirst({
        where: { schoolId: ctx.schoolId, isCurrent: true },
        select: { id: true },
      })
    )?.id;
  if (!academicYearId) return { ok: false, error: "NO_CURRENT_YEAR" };

  let enrolled: {
    studentId: string;
    enrollmentId: string | null;
    alreadyEnrolled: boolean;
  };
  try {
    enrolled = await prisma.$transaction(async (tx) => {
      // 1) Fiche élève : existante (contrôle statut) ou créée dans la tx.
      let studentId = input.studentId;
      if (studentId) {
        const student = await tx.student.findFirst({
          where: { id: studentId, schoolId: ctx.schoolId },
          select: { id: true, status: true },
        });
        if (!student) throw new RegistrationAbort("NOT_FOUND");
        if (student.status !== "ACTIVE") {
          throw new RegistrationAbort("STUDENT_INACTIVE");
        }
      } else {
        const created = await createStudent(ctx, input.student!, tx);
        if (!created.ok) throw new RegistrationAbort(created.error);
        studentId = created.result.id;
      }

      // 2) Inscription (sauf si déjà ENROLLED sur l'année — réinscription
      //    idempotente : on vérifie seulement les créances).
      const existingEnrollment = await tx.enrollment.findFirst({
        where: {
          schoolId: ctx.schoolId,
          studentId,
          academicYearId,
          status: "ENROLLED",
        },
        select: { id: true },
      });
      if (existingEnrollment) {
        return { studentId, enrollmentId: existingEnrollment.id, alreadyEnrolled: true };
      }
      const res = await enrollStudent(
        ctx,
        { studentId, classroomId: input.classroomId, academicYearId },
        tx,
      );
      if (!res.ok) throw new RegistrationAbort(res.error);
      return { studentId, enrollmentId: res.result.id, alreadyEnrolled: false };
    });
  } catch (e) {
    if (e instanceof RegistrationAbort) {
      return { ok: false, error: e.code };
    }
    return { ok: false, error: "CREATE_FAILED" };
  }

  // 3) Créances individuelles — idempotent, aucun montant inventé.
  //    Hors transaction : voir note d'en-tête (P2002 → 25P02).
  const charges = await generateStudentCharges(ctx, {
    studentId: enrolled.studentId,
    academicYearId,
  });

  return {
    ok: true,
    result: {
      studentId: enrolled.studentId,
      enrollmentId: enrolled.enrollmentId,
      alreadyEnrolled: enrolled.alreadyEnrolled,
      charges: charges.ok
        ? {
            created: charges.result.created,
            existing: charges.result.existing,
            skipped: charges.result.skipped,
          }
        : { created: 0, existing: 0, skipped: 0 },
      noTariffs: charges.ok ? charges.result.tariffs === 0 : false,
      chargesError: charges.ok ? null : charges.error,
      academicYearId,
    },
  };
}

/** Erreur métier transportée hors de la transaction Prisma. */
class RegistrationAbort extends Error {
  constructor(public readonly code: RegistrationError) {
    super(code);
    this.name = "RegistrationAbort";
  }
}
