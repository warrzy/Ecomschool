import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";

export type AccountsError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CREATE_FAILED"
  | "UPDATE_FAILED";

export type AccountsResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: AccountsError };

type SchoolCtx = { userId: string; schoolId: string };

// ---------- Génération des créances ----------

/**
 * Génère les charges applicables aux élèves inscrits pour une année.
 * Idempotent (unicité studentId+year+category). Seuls les tarifs
 * obligatoires et actifs sont appliqués ; le montant est figé.
 */
export async function generateCharges(
  ctx: SchoolCtx,
  input: { academicYearId: string; classroomId?: string },
): Promise<AccountsResult<{ created: number; existing: number; skipped: number }>> {
  const year = await prisma.academicYear.findFirst({
    where: { id: input.academicYearId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!year) return { ok: false, error: "NOT_FOUND" };

  const tariffs = await prisma.feeTariff.findMany({
    where: {
      schoolId: ctx.schoolId,
      academicYearId: year.id,
      status: "ACTIVE",
      mandatory: true,
      ...(input.classroomId
        ? { OR: [{ classroomId: input.classroomId }, { classroomId: null }] }
        : {}),
    },
    select: {
      id: true,
      categoryId: true,
      levelId: true,
      classroomId: true,
      amount: true,
      paymentPlan: true,
      installmentCount: true,
      effectiveFrom: true,
    },
  });

  const enrollments = await prisma.enrollment.findMany({
    where: {
      schoolId: ctx.schoolId,
      academicYearId: year.id,
      status: "ENROLLED",
      ...(input.classroomId ? { classroomId: input.classroomId } : {}),
    },
    select: { studentId: true, classroom: { select: { levelId: true } } },
  });

  let created = 0;
  let existing = 0;
  let skipped = 0;
  for (const en of enrollments) {
    for (const t of tariffs) {
      if (t.classroomId && t.classroomId !== input.classroomId) {
        // tarif restreint à une classe précise : vérifier l'inscription réelle
        const inClass = await prisma.enrollment.findFirst({
          where: {
            schoolId: ctx.schoolId,
            academicYearId: year.id,
            studentId: en.studentId,
            classroomId: t.classroomId,
            status: "ENROLLED",
          },
          select: { id: true },
        });
        if (!inClass) continue;
      }
      if (t.levelId && en.classroom.levelId !== t.levelId) continue;

      // La contrainte unique (studentId, academicYearId, categoryId) est la
      // source de vérité : `create` + P2002 donne un comptage exact même si
      // deux générations tournent en concurrence — aucun doublon possible.
      try {
        const charge = await prisma.studentFeeCharge.create({
          data: {
            schoolId: ctx.schoolId,
            studentId: en.studentId,
            academicYearId: year.id,
            categoryId: t.categoryId,
            tariffId: t.id,
            amount: t.amount,
          },
          select: { id: true },
        });
        created++;
        await createInstallments(charge.id, ctx.schoolId, en.studentId, year.id, {
          amount: t.amount,
          count: t.installmentCount,
          from: t.effectiveFrom,
        });
      } catch (e) {
        if ((e as { code?: string })?.code === "P2002") {
          existing++;
          // La créance existait déjà : garantir ses échéances si absentes
          // (ex. créance créée avant la définition du plan de paiement).
          const charge = await prisma.studentFeeCharge.findUnique({
            where: {
              studentId_academicYearId_categoryId: {
                studentId: en.studentId,
                academicYearId: year.id,
                categoryId: t.categoryId,
              },
            },
            select: { id: true },
          });
          if (
            charge &&
            (await prisma.feeInstallment.count({
              where: { chargeId: charge.id },
            })) === 0
          ) {
            await createInstallments(
              charge.id,
              ctx.schoolId,
              en.studentId,
              year.id,
              {
                amount: t.amount,
                count: t.installmentCount,
                from: t.effectiveFrom,
              },
            );
          }
        } else {
          skipped++;
        }
      }
    }
  }

  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "finance.charges.generate",
    entity: "AcademicYear",
    entityId: year.id,
    metadata: { created, existing, skipped, classroomId: input.classroomId },
  });
  return { ok: true, result: { created, existing, skipped } };
}

/** Répartition en n échéances mensuelles (reliquat sur la dernière). */
async function createInstallments(
  chargeId: string,
  schoolId: string,
  studentId: string,
  academicYearId: string,
  opts: { amount: number; count: number; from: Date },
) {
  const n = Math.max(1, opts.count);
  const base = Math.floor(opts.amount / n);
  const rows = Array.from({ length: n }, (_, i) => ({
    schoolId,
    chargeId,
    studentId,
    academicYearId,
    label: `Tranche ${i + 1}/${n}`,
    amount: i === n - 1 ? opts.amount - base * (n - 1) : base,
    dueDate: new Date(
      Date.UTC(opts.from.getUTCFullYear(), opts.from.getUTCMonth() + i, 1),
    ),
  }));
  await prisma.feeInstallment.createMany({ data: rows });
}

export async function updateInstallment(
  ctx: SchoolCtx,
  id: string,
  input: { dueDate?: Date; amount?: number; label?: string },
): Promise<AccountsResult> {
  const inst = await prisma.feeInstallment.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!inst) return { ok: false, error: "NOT_FOUND" };
  if (input.amount !== undefined && (!Number.isInteger(input.amount) || input.amount < 0)) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  await prisma.feeInstallment.update({
    where: { id },
    data: {
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.label !== undefined ? { label: input.label.trim() || null } : {}),
    },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "finance.installment.update",
    entity: "FeeInstallment",
    entityId: id,
  });
  return { ok: true, result: undefined };
}

// ---------- Compte financier élève ----------

export type InstallmentStatus = "UPCOMING" | "PARTIAL" | "PAID" | "LATE" | "CANCELLED";

export function installmentStatus(input: {
  amount: number;
  paid: number;
  dueDate: Date;
  cancelled: boolean;
  today?: Date;
}): InstallmentStatus {
  if (input.cancelled) return "CANCELLED";
  if (input.paid >= input.amount) return "PAID";
  if (input.paid > 0) return "PARTIAL";
  const today = input.today ?? new Date();
  if (input.dueDate < today) return "LATE";
  return "UPCOMING";
}

/** Vue du compte financier d'un élève pour une année scolaire. */
export async function getStudentAccount(
  ctx: SchoolCtx,
  input: { studentId: string; academicYearId: string },
) {
  const student = await prisma.student.findFirst({
    where: { id: input.studentId, schoolId: ctx.schoolId },
    select: {
      id: true,
      matricule: true,
      firstName: true,
      lastName: true,
      enrollments: {
        where: { academicYearId: input.academicYearId, status: "ENROLLED" },
        select: { classroom: { select: { name: true } } },
        take: 1,
      },
    },
  });
  if (!student) return null;

  const [charges, discounts, installments, payments] = await Promise.all([
    prisma.studentFeeCharge.findMany({
      where: {
        schoolId: ctx.schoolId,
        studentId: input.studentId,
        academicYearId: input.academicYearId,
        status: "ACTIVE",
      },
      include: { category: { select: { code: true, label: true } } },
      orderBy: { category: { label: "asc" } },
    }),
    prisma.feeDiscount.findMany({
      where: {
        schoolId: ctx.schoolId,
        studentId: input.studentId,
        academicYearId: input.academicYearId,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.feeInstallment.findMany({
      where: {
        schoolId: ctx.schoolId,
        studentId: input.studentId,
        academicYearId: input.academicYearId,
        status: "ACTIVE",
        charge: { status: "ACTIVE" },
      },
      include: {
        charge: { select: { category: { select: { label: true } } } },
        allocations: {
          where: { payment: { status: "VALIDATED" } },
          select: { amount: true },
        },
      },
      orderBy: { dueDate: "asc" },
    }),
    prisma.payment.findMany({
      where: {
        schoolId: ctx.schoolId,
        studentId: input.studentId,
        academicYearId: input.academicYearId,
      },
      orderBy: { paidAt: "desc" },
      include: {
        allocations: {
          include: {
            installment: {
              select: {
                label: true,
                dueDate: true,
                charge: { select: { category: { select: { label: true } } } },
              },
            },
          },
        },
      },
    }),
  ]);

  const totalCharges = charges.reduce((s, c) => s + c.amount, 0);
  const activeDiscounts = discounts.filter((d) => d.status === "ACTIVE");
  const discountAmount = activeDiscounts.reduce(
    (s, d) =>
      s +
      (d.type === "PERCENT"
        ? Math.floor((totalCharges * d.value) / 100)
        : d.type === "EXEMPTION"
          ? totalCharges
          : d.value),
    0,
  );
  const due = Math.max(0, totalCharges - discountAmount);
  const paid = payments
    .filter((p) => p.status === "VALIDATED")
    .reduce((s, p) => s + p.amount, 0);

  const today = new Date();
  const installmentViews = installments.map((i) => {
    const paidAmount = i.allocations.reduce((s, a) => s + a.amount, 0);
    return {
      ...i,
      categoryLabel: i.charge.category.label,
      paidAmount,
      remaining: Math.max(0, i.amount - paidAmount),
      computedStatus: installmentStatus({
        amount: i.amount,
        paid: paidAmount,
        dueDate: i.dueDate,
        cancelled: false,
        today,
      }),
    };
  });

  return {
    student: {
      id: student.id,
      matricule: student.matricule,
      firstName: student.firstName,
      lastName: student.lastName,
      classroomName: student.enrollments[0]?.classroom.name ?? null,
    },
    charges,
    discounts,
    installments: installmentViews,
    payments,
    totals: {
      charges: totalCharges,
      discounts: discountAmount,
      due,
      paid,
      balance: due - paid,
    },
  };
}

/** Liste des années avec données financières pour un élève. */
export async function studentFinanceYears(ctx: SchoolCtx, studentId: string) {
  const years = await prisma.studentFeeCharge.findMany({
    where: { schoolId: ctx.schoolId, studentId },
    select: { academicYear: { select: { id: true, name: true } } },
    distinct: ["academicYearId"],
  });
  return years.map((y) => y.academicYear);
}

/** Liste des comptes financiers (vue agrégée) pour une année. */
export async function listAccounts(
  ctx: SchoolCtx,
  input: { academicYearId: string; classroomId?: string },
) {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      schoolId: ctx.schoolId,
      academicYearId: input.academicYearId,
      status: "ENROLLED",
      ...(input.classroomId ? { classroomId: input.classroomId } : {}),
    },
    select: {
      student: {
        select: { id: true, matricule: true, firstName: true, lastName: true },
      },
      classroom: { select: { id: true, name: true } },
    },
    orderBy: { student: { lastName: "asc" } },
  });

  const charges = await prisma.studentFeeCharge.groupBy({
    by: ["studentId"],
    where: {
      schoolId: ctx.schoolId,
      academicYearId: input.academicYearId,
      status: "ACTIVE",
    },
    _sum: { amount: true },
  });
  const discounts = await prisma.feeDiscount.findMany({
    where: {
      schoolId: ctx.schoolId,
      academicYearId: input.academicYearId,
      status: "ACTIVE",
    },
    select: { studentId: true, type: true, value: true },
  });
  const payments = await prisma.payment.groupBy({
    by: ["studentId"],
    where: {
      schoolId: ctx.schoolId,
      academicYearId: input.academicYearId,
      status: "VALIDATED",
    },
    _sum: { amount: true },
  });

  const chargeBy = new Map(charges.map((c) => [c.studentId, c._sum.amount ?? 0]));
  const paidBy = new Map(payments.map((p) => [p.studentId, p._sum.amount ?? 0]));
  const discBy = new Map<string, { type: string; value: number }[]>();
  for (const d of discounts) {
    if (!discBy.has(d.studentId)) discBy.set(d.studentId, []);
    discBy.get(d.studentId)!.push(d);
  }

  return enrollments.map((e) => {
    const total = chargeBy.get(e.student.id) ?? 0;
    const disc = (discBy.get(e.student.id) ?? []).reduce(
      (s, d) =>
        s + (d.type === "PERCENT" ? Math.floor((total * d.value) / 100) : d.type === "EXEMPTION" ? total : d.value),
      0,
    );
    const due = Math.max(0, total - disc);
    const paid = paidBy.get(e.student.id) ?? 0;
    return {
      student: e.student,
      classroom: e.classroom,
      charges: total,
      discounts: disc,
      due,
      paid,
      balance: due - paid,
    };
  });
}

// ---------- Réductions ----------

export async function createDiscount(
  ctx: SchoolCtx,
  input: {
    studentId: string;
    academicYearId: string;
    type: "FIXED_AMOUNT" | "PERCENT" | "SCHOLARSHIP" | "EXEMPTION" | "FAMILY" | "EXCEPTIONAL";
    value: number;
    reason: string;
  },
): Promise<AccountsResult<{ id: string }>> {
  if (!input.reason.trim()) return { ok: false, error: "INVALID_INPUT" };
  if (input.type === "PERCENT" && (input.value < 0 || input.value > 100)) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (input.type !== "PERCENT" && input.type !== "EXEMPTION" && input.value <= 0) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const student = await prisma.student.findFirst({
    where: { id: input.studentId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  const year = await prisma.academicYear.findFirst({
    where: { id: input.academicYearId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!student || !year) return { ok: false, error: "NOT_FOUND" };

  try {
    const d = await prisma.feeDiscount.create({
      data: {
        schoolId: ctx.schoolId,
        studentId: input.studentId,
        academicYearId: input.academicYearId,
        type: input.type,
        value: input.value,
        reason: input.reason.trim(),
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "finance.discount.create",
      entity: "FeeDiscount",
      entityId: d.id,
      metadata: { type: input.type, value: input.value, reason: input.reason },
    });
    return { ok: true, result: d };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function archiveDiscount(ctx: SchoolCtx, id: string): Promise<AccountsResult> {
  const d = await prisma.feeDiscount.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!d) return { ok: false, error: "NOT_FOUND" };
  await prisma.feeDiscount.update({
    where: { id },
    data: { status: "ARCHIVED" },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "finance.discount.archive",
    entity: "FeeDiscount",
    entityId: id,
  });
  return { ok: true, result: undefined };
}
