import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import type { Prisma } from "@prisma/client";

export type AccountsError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "NOT_ENROLLED"
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
      const r = await applyTariff(prisma, {
        schoolId: ctx.schoolId,
        academicYearId: year.id,
        studentId: en.studentId,
        studentLevelId: en.classroom.levelId,
        tariff: t,
      });
      if (r === "created") created++;
      else if (r === "existing") existing++;
      else skipped++;
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

type TariffForCharge = {
  id: string;
  categoryId: string;
  levelId: string | null;
  classroomId: string | null;
  amount: number;
  installmentCount: number;
  effectiveFrom: Date;
};

/**
 * Applique un tarif à un élève : crée la créance + ses échéances.
 * La contrainte unique (studentId, academicYearId, categoryId) est la
 * source de vérité : `create` + P2002 donne un comptage exact même si
 * deux générations tournent en concurrence — aucun doublon possible.
 */
async function applyTariff(
  db: Prisma.TransactionClient | typeof prisma,
  input: {
    schoolId: string;
    academicYearId: string;
    studentId: string;
    studentLevelId: string | null;
    tariff: TariffForCharge;
  },
): Promise<"created" | "existing" | "skipped"> {
  const t = input.tariff;
  if (t.classroomId) {
    // Tarif restreint à une classe précise : vérifier l'inscription réelle.
    const inClass = await db.enrollment.findFirst({
      where: {
        schoolId: input.schoolId,
        academicYearId: input.academicYearId,
        studentId: input.studentId,
        classroomId: t.classroomId,
        status: "ENROLLED",
      },
      select: { id: true },
    });
    if (!inClass) return "skipped";
  }
  if (t.levelId && input.studentLevelId !== t.levelId) return "skipped";

  try {
    const charge = await db.studentFeeCharge.create({
      data: {
        schoolId: input.schoolId,
        studentId: input.studentId,
        academicYearId: input.academicYearId,
        categoryId: t.categoryId,
        tariffId: t.id,
        amount: t.amount,
      },
      select: { id: true },
    });
    await createInstallments(
      charge.id,
      input.schoolId,
      input.studentId,
      input.academicYearId,
      { amount: t.amount, count: t.installmentCount, from: t.effectiveFrom },
      db,
    );
    return "created";
  } catch (e) {
    if ((e as { code?: string })?.code !== "P2002") return "skipped";
    // La créance existait déjà : garantir ses échéances si absentes
    // (ex. créance créée avant la définition du plan de paiement).
    const charge = await db.studentFeeCharge.findUnique({
      where: {
        studentId_academicYearId_categoryId: {
          studentId: input.studentId,
          academicYearId: input.academicYearId,
          categoryId: t.categoryId,
        },
      },
      select: { id: true },
    });
    if (
      charge &&
      (await db.feeInstallment.count({ where: { chargeId: charge.id } })) === 0
    ) {
      await createInstallments(
        charge.id,
        input.schoolId,
        input.studentId,
        input.academicYearId,
        { amount: t.amount, count: t.installmentCount, from: t.effectiveFrom },
        db,
      );
    }
    return "existing";
  }
}

/**
 * Génère les créances applicables à UN élève inscrit pour une année
 * (par ex. inscription au guichet après la génération en masse).
 * Idempotent : seules les créances manquantes sont créées ; aucune remise
 * ni montant n'est inventé — seuls les tarifs obligatoires actifs
 * applicables (niveau / classe) sont utilisés.
 * `tariffs` dans le résultat = nombre de tarifs applicables trouvés :
 * 0 signifie qu'aucun tarif n'est configuré (l'inscription reste valable).
 */
export async function generateStudentCharges(
  ctx: SchoolCtx,
  input: { studentId: string; academicYearId: string },
  tx?: Prisma.TransactionClient,
): Promise<
  AccountsResult<{
    created: number;
    existing: number;
    skipped: number;
    tariffs: number;
  }>
> {
  const db = tx ?? prisma;
  const year = await db.academicYear.findFirst({
    where: { id: input.academicYearId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!year) return { ok: false, error: "NOT_FOUND" };

  const enrollment = await db.enrollment.findFirst({
    where: {
      schoolId: ctx.schoolId,
      academicYearId: year.id,
      studentId: input.studentId,
      status: "ENROLLED",
    },
    select: { classroom: { select: { id: true, levelId: true } } },
  });
  if (!enrollment) return { ok: false, error: "NOT_ENROLLED" };

  const tariffs = await db.feeTariff.findMany({
    where: {
      schoolId: ctx.schoolId,
      academicYearId: year.id,
      status: "ACTIVE",
      mandatory: true,
      OR: [
        { classroomId: enrollment.classroom.id },
        { classroomId: null },
      ],
    },
    select: {
      id: true,
      categoryId: true,
      levelId: true,
      classroomId: true,
      amount: true,
      installmentCount: true,
      effectiveFrom: true,
    },
  });

  let created = 0;
  let existing = 0;
  let skipped = 0;
  for (const t of tariffs) {
    const r = await applyTariff(db, {
      schoolId: ctx.schoolId,
      academicYearId: year.id,
      studentId: input.studentId,
      studentLevelId: enrollment.classroom.levelId,
      tariff: t,
    });
    if (r === "created") created++;
    else if (r === "existing") existing++;
    else skipped++;
  }

  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "finance.charges.generate",
    entity: "Student",
    entityId: input.studentId,
    metadata: {
      created,
      existing,
      skipped,
      tariffs: tariffs.length,
      academicYearId: year.id,
    },
    tx,
  });
  return {
    ok: true,
    result: { created, existing, skipped, tariffs: tariffs.length },
  };
}

/**
 * Lecture seule : créances attendues mais manquantes pour l'inscription
 * active d'un élève sur une année — mêmes règles d'applicabilité que
 * generateStudentCharges (tarifs obligatoires actifs, niveau / classe).
 * Sert à proposer la reprise de génération sur le dossier financier,
 * indépendamment du paramètre d'URL de la session d'inscription.
 * `tariffs` = catégories attendues ; 0 = aucun tarif configuré
 * (situation normale, pas une erreur — aucune reprise proposée).
 * Une créance existante, même annulée, occupe son slot d'unicité :
 * elle n'est donc jamais comptée « manquante ».
 */
export async function missingStudentCharges(
  ctx: SchoolCtx,
  input: { studentId: string; academicYearId: string },
): Promise<{ enrolled: boolean; expected: number; missing: number }> {
  const year = await prisma.academicYear.findFirst({
    where: { id: input.academicYearId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!year) return { enrolled: false, expected: 0, missing: 0 };

  const enrollment = await prisma.enrollment.findFirst({
    where: {
      schoolId: ctx.schoolId,
      academicYearId: year.id,
      studentId: input.studentId,
      status: "ENROLLED",
    },
    select: { classroom: { select: { id: true, levelId: true } } },
  });
  if (!enrollment) return { enrolled: false, expected: 0, missing: 0 };

  const [tariffs, existing] = await Promise.all([
    prisma.feeTariff.findMany({
      where: {
        schoolId: ctx.schoolId,
        academicYearId: year.id,
        status: "ACTIVE",
        mandatory: true,
        OR: [
          { classroomId: enrollment.classroom.id },
          { classroomId: null },
        ],
      },
      select: { categoryId: true, levelId: true },
    }),
    prisma.studentFeeCharge.findMany({
      where: {
        schoolId: ctx.schoolId,
        studentId: input.studentId,
        academicYearId: year.id,
      },
      select: { categoryId: true },
    }),
  ]);

  const expected = new Set(
    tariffs
      .filter(
        (t) => t.levelId === null || t.levelId === enrollment.classroom.levelId,
      )
      .map((t) => t.categoryId),
  );
  const have = new Set(existing.map((c) => c.categoryId));
  const missing = [...expected].filter((c) => !have.has(c)).length;
  return { enrolled: true, expected: expected.size, missing };
}
async function createInstallments(
  chargeId: string,
  schoolId: string,
  studentId: string,
  academicYearId: string,
  opts: { amount: number; count: number; from: Date },
  db: Prisma.TransactionClient | typeof prisma = prisma,
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
  await db.feeInstallment.createMany({ data: rows });
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
/** Normalise pour la recherche : minuscules + accents retirés. */
const normSearch = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export async function listAccounts(
  ctx: SchoolCtx,
  input: { academicYearId: string; classroomId?: string; query?: string },
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

  // Recherche serveur : nom/prénom/matricule, casse et accents ignorés.
  // Tous les mots de la requête doivent correspondre (haystack combiné).
  const tokens = (input.query ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(normSearch);
  const filtered = tokens.length
    ? enrollments.filter((e) => {
        const hay = normSearch(
          `${e.student.matricule} ${e.student.firstName} ${e.student.lastName}`,
        );
        return tokens.every((t) => hay.includes(t));
      })
    : enrollments;

  const chargeBy = new Map(charges.map((c) => [c.studentId, c._sum.amount ?? 0]));
  const paidBy = new Map(payments.map((p) => [p.studentId, p._sum.amount ?? 0]));
  const discBy = new Map<string, { type: string; value: number }[]>();
  for (const d of discounts) {
    if (!discBy.has(d.studentId)) discBy.set(d.studentId, []);
    discBy.get(d.studentId)!.push(d);
  }

  return filtered.map((e) => {
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
