import { prisma } from "@/lib/db/prisma";
import { monthlySeries } from "@/lib/services/platform/dashboard";
import { logAudit } from "@/lib/services/audit";
import { notifyUsers } from "@/lib/services/notifications";
import type { PaymentMethod, PaymentStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";

export type PaymentsError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CLOSED_DAY"
  | "ALREADY_CANCELLED"
  | "CREATE_FAILED";

export type PaymentsResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: PaymentsError };

type SchoolCtx = { userId: string; schoolId: string };

function dayBounds(d: Date) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// ---------- Encaissements ----------

/**
 * Enregistre un encaissement avec répartition sur les échéances.
 * - Idempotent via `idempotencyKey` (unique par école) : un appel répété
 *   renvoie le paiement existant sans doublon.
 * - Refusé si le jour est clôturé (CashClosure).
 * - Répartition par défaut : FIFO sur les échéances non soldées.
 * - Le reçu est un snapshot immuable (receiptSnapshot) — numéro unique REC-YYYY-####.
 */
export async function recordPayment(
  ctx: SchoolCtx,
  input: {
    studentId: string;
    academicYearId: string;
    amount: number;
    method: PaymentMethod;
    paidAt?: Date;
    reference?: string;
    observation?: string;
    allocations?: { installmentId: string; amount: number }[];
    idempotencyKey?: string;
  },
): Promise<PaymentsResult<{ id: string; receiptNumber: string }>> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, error: "INVALID_INPUT" };
  }
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
  const year = await prisma.academicYear.findFirst({
    where: { id: input.academicYearId, schoolId: ctx.schoolId },
    select: { id: true, name: true },
  });
  if (!student || !year) return { ok: false, error: "NOT_FOUND" };

  const paidAt = input.paidAt ?? new Date();
  const { start, end } = dayBounds(paidAt);

  // Idempotence : une clé déjà consommée renvoie le paiement existant.
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  if (input.idempotencyKey) {
    const existing = await prisma.payment.findFirst({
      where: { schoolId: ctx.schoolId, idempotencyKey: input.idempotencyKey },
      select: { id: true, receiptNumber: true },
    });
    if (existing?.receiptNumber) {
      return { ok: true, result: { id: existing.id, receiptNumber: existing.receiptNumber } };
    }
  }

  const closure = await prisma.cashClosure.findFirst({
    where: { schoolId: ctx.schoolId, date: { gte: start, lt: end } },
    select: { id: true },
  });
  if (closure) return { ok: false, error: "CLOSED_DAY" };

  // Répartition : explicite (somme = montant) ou FIFO sur les échéances dues.
  const allocations = input.allocations ?? [];
  if (allocations.length === 0) {
    const open = await prisma.feeInstallment.findMany({
      where: {
        schoolId: ctx.schoolId,
        studentId: input.studentId,
        academicYearId: input.academicYearId,
        status: "ACTIVE",
        charge: { status: "ACTIVE" },
      },
      include: {
        allocations: {
          where: { payment: { status: "VALIDATED" } },
          select: { amount: true },
        },
      },
      orderBy: { dueDate: "asc" },
    });
    let remaining = input.amount;
    for (const inst of open) {
      const alreadyPaid = inst.allocations.reduce((s, a) => s + a.amount, 0);
      const due = Math.max(0, inst.amount - alreadyPaid);
      if (due <= 0 || remaining <= 0) continue;
      const part = Math.min(due, remaining);
      allocations.push({ installmentId: inst.id, amount: part });
      remaining -= part;
    }
  } else {
    const sum = allocations.reduce((s, a) => s + a.amount, 0);
    if (sum !== input.amount) return { ok: false, error: "INVALID_INPUT" };
    const instIds = allocations.map((a) => a.installmentId);
    const count = await prisma.feeInstallment.count({
      where: {
        id: { in: instIds },
        schoolId: ctx.schoolId,
        studentId: input.studentId,
        status: "ACTIVE",
      },
    });
    if (count !== instIds.length) return { ok: false, error: "NOT_FOUND" };
  }

  const school = await prisma.school.findUnique({
    where: { id: ctx.schoolId },
    select: { name: true, logoUrl: true, address: true, city: true, phone: true, currency: true },
  });
  const agent = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { firstName: true, lastName: true, email: true },
  });

  const runTransaction = () =>
    prisma.$transaction(
      async (tx) => {
        const seq = await tx.payment.count({
          where: { schoolId: ctx.schoolId, receiptNumber: { not: null } },
        });
        const receiptNumber = `REC-${paidAt.getUTCFullYear()}-${String(seq + 1).padStart(5, "0")}`;

        // Solde après paiement (snapshot reçu)
        const [chargesSum, paidSum] = await Promise.all([
          tx.studentFeeCharge.aggregate({
            where: {
              schoolId: ctx.schoolId,
              studentId: input.studentId,
              academicYearId: input.academicYearId,
              status: "ACTIVE",
            },
            _sum: { amount: true },
          }),
          tx.payment.aggregate({
            where: {
              schoolId: ctx.schoolId,
              studentId: input.studentId,
              academicYearId: input.academicYearId,
              status: "VALIDATED",
            },
            _sum: { amount: true },
          }),
        ]);
        const discounts = await tx.feeDiscount.findMany({
          where: {
            schoolId: ctx.schoolId,
            studentId: input.studentId,
            academicYearId: input.academicYearId,
            status: "ACTIVE",
          },
          select: { type: true, value: true },
        });
        const total = chargesSum._sum.amount ?? 0;
        const disc = discounts.reduce(
          (s, d) =>
            s + (d.type === "PERCENT" ? Math.floor((total * d.value) / 100) : d.type === "EXEMPTION" ? total : d.value),
          0,
        );
        const due = Math.max(0, total - disc);
        const balanceAfter = due - ((paidSum._sum.amount ?? 0) + input.amount);

        const p = await tx.payment.create({
          data: {
            schoolId: ctx.schoolId,
            studentId: input.studentId,
            academicYearId: input.academicYearId,
            amount: input.amount,
            paidAt,
            method: input.method,
            reference: input.reference?.trim() || null,
            observation: input.observation?.trim() || null,
            receivedById: ctx.userId,
            receiptNumber,
            idempotencyKey,
            receiptSnapshot: {
              receiptNumber,
              issuedAt: paidAt.toISOString(),
              school: school ?? null,
              student: {
                matricule: student.matricule,
                firstName: student.firstName,
                lastName: student.lastName,
                classroomName: student.enrollments[0]?.classroom.name ?? null,
              },
              academicYear: year.name,
              amount: input.amount,
              currency: school?.currency ?? "XOF",
              method: input.method,
              reference: input.reference?.trim() || null,
              observation: input.observation?.trim() || null,
              agent: agent
                ? `${agent.firstName ?? ""} ${agent.lastName ?? ""}`.trim() || agent.email
                : null,
              balanceAfter,
              allocations: allocations.map((a) => ({
                installmentId: a.installmentId,
                amount: a.amount,
              })),
            },
            allocations: {
              create: allocations.map((a) => ({
                installmentId: a.installmentId,
                amount: a.amount,
              })),
            },
          },
          select: { id: true, receiptNumber: true },
        });
        return p;
      },
      { isolationLevel: "Serializable" },
    );

  try {
    // Retry sur les conflits de sérialisation (encaissements simultanés).
    let payment: { id: string; receiptNumber: string | null } | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4 && !payment; attempt++) {
      try {
        payment = await runTransaction();
      } catch (e) {
        lastError = e;
        const code = (e as { code?: string })?.code;
        if (code === "P2002") {
          // Course sur la même clé d'idempotence → le paiement concurrent a gagné
          const existing = await prisma.payment.findFirst({
            where: { schoolId: ctx.schoolId, idempotencyKey },
            select: { id: true, receiptNumber: true },
          });
          if (existing?.receiptNumber) {
            payment = { id: existing.id, receiptNumber: existing.receiptNumber };
            break;
          }
          continue; // conflit de numéro de reçu → nouvelle tentative
        }
        // P2034 = échec de sérialisation → nouvelle tentative
        if (code !== "P2034") throw e;
      }
    }
    if (!payment) throw lastError;

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "finance.payment.create",
      entity: "Payment",
      entityId: payment.id,
      metadata: {
        amount: input.amount,
        method: input.method,
        receiptNumber: payment.receiptNumber,
      },
    });
    return { ok: true, result: { id: payment.id, receiptNumber: payment.receiptNumber! } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

/** Annulation auditée — jamais de suppression physique. */
export async function cancelPayment(
  ctx: SchoolCtx,
  input: { paymentId: string; reason: string },
): Promise<PaymentsResult> {
  if (!input.reason.trim()) return { ok: false, error: "INVALID_INPUT" };
  const p = await prisma.payment.findFirst({
    where: { id: input.paymentId, schoolId: ctx.schoolId },
    select: { id: true, status: true, paidAt: true },
  });
  if (!p) return { ok: false, error: "NOT_FOUND" };
  if (p.status === "CANCELLED") return { ok: false, error: "ALREADY_CANCELLED" };

  const { start, end } = dayBounds(p.paidAt);
  const closure = await prisma.cashClosure.findFirst({
    where: { schoolId: ctx.schoolId, date: { gte: start, lt: end } },
    select: { id: true },
  });
  if (closure) return { ok: false, error: "CLOSED_DAY" };

  await prisma.payment.update({
    where: { id: p.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledById: ctx.userId,
      cancelReason: input.reason.trim(),
    },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "finance.payment.cancel",
    entity: "Payment",
    entityId: p.id,
    metadata: { reason: input.reason },
  });
  return { ok: true, result: undefined };
}

// ---------- Journal et caisse ----------

export async function listPayments(
  ctx: SchoolCtx,
  filters: {
    academicYearId?: string;
    from?: Date;
    to?: Date;
    method?: PaymentMethod;
    classroomId?: string;
    studentId?: string;
    status?: PaymentStatus;
    receivedById?: string;
    includeCancelled?: boolean;
    query?: string;
  } = {},
  opts: { take?: number; cursor?: string } = {},
) {
  const q = filters.query?.trim();
  return prisma.payment.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
      ...(q
        ? {
            OR: [
              { reference: { contains: q, mode: "insensitive" } },
              { receiptNumber: { contains: q, mode: "insensitive" } },
              { student: { matricule: { contains: q, mode: "insensitive" } } },
              { student: { firstName: { contains: q, mode: "insensitive" } } },
              { student: { lastName: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
      ...(filters.from || filters.to
        ? {
            paidAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lt: filters.to } : {}),
            },
          }
        : {}),
      ...(filters.method ? { method: filters.method } : {}),
      ...(filters.studentId ? { studentId: filters.studentId } : {}),
      ...(filters.status
        ? { status: filters.status }
        : filters.includeCancelled
          ? {}
          : { status: "VALIDATED" }),
      ...(filters.receivedById ? { receivedById: filters.receivedById } : {}),
      ...(filters.classroomId
        ? {
            student: {
              enrollments: {
                some: {
                  classroomId: filters.classroomId,
                  academicYearId: filters.academicYearId ?? undefined,
                },
              },
            },
          }
        : {}),
    },
    include: {
      student: { select: { matricule: true, firstName: true, lastName: true } },
    },
    // Tri déterministe (tiebreaker id) requis pour la pagination curseur.
    orderBy: [{ paidAt: "desc" }, { id: "asc" }],
    take: opts.take ?? 500,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
}

/** Clôture une journée de caisse : total figé, blocage des encaissements ultérieurs. */
export async function closeCashDay(
  ctx: SchoolCtx,
  date: Date,
): Promise<PaymentsResult<{ id: string; totalAmount: number }>> {
  const { start, end } = dayBounds(date);
  const existing = await prisma.cashClosure.findFirst({
    where: { schoolId: ctx.schoolId, date: { gte: start, lt: end } },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "INVALID_INPUT" };

  const agg = await prisma.payment.aggregate({
    where: {
      schoolId: ctx.schoolId,
      status: "VALIDATED",
      paidAt: { gte: start, lt: end },
    },
    _sum: { amount: true },
    _count: true,
  });
  try {
    const c = await prisma.cashClosure.create({
      data: {
        schoolId: ctx.schoolId,
        date: start,
        totalAmount: agg._sum.amount ?? 0,
        paymentsCount: agg._count,
        closedById: ctx.userId,
      },
      select: { id: true },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "finance.cash.close",
      entity: "CashClosure",
      entityId: c.id,
      metadata: { date: start.toISOString().slice(0, 10), total: agg._sum.amount },
    });
    return { ok: true, result: { id: c.id, totalAmount: agg._sum.amount ?? 0 } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function listCashClosures(ctx: SchoolCtx) {
  return prisma.cashClosure.findMany({
    where: { schoolId: ctx.schoolId },
    orderBy: { date: "desc" },
    take: 90,
  });
}

// ---------- Impayés ----------

/**
 * Soldes restants par échéance.
 * - Les réductions/exonérations sont déduites des échéances les plus
 *   anciennes (même règle que la répartition FIFO des paiements).
 * - `exigible` distingue les échéances échues des échéances futures.
 */
export async function listUnpaid(
  ctx: SchoolCtx,
  input: { academicYearId: string; classroomId?: string },
) {
  const today = new Date();
  const [installments, discounts] = await Promise.all([
    prisma.feeInstallment.findMany({
      where: {
        schoolId: ctx.schoolId,
        academicYearId: input.academicYearId,
        status: "ACTIVE",
        charge: { status: "ACTIVE" },
        ...(input.classroomId
          ? {
              student: {
                enrollments: {
                  some: {
                    academicYearId: input.academicYearId,
                    classroomId: input.classroomId,
                    status: "ENROLLED",
                  },
                },
              },
            }
          : {}),
      },
      include: {
        student: {
          select: {
            id: true,
            matricule: true,
            firstName: true,
            lastName: true,
            enrollments: {
              where: { academicYearId: input.academicYearId, status: "ENROLLED" },
              select: { classroom: { select: { name: true, level: { select: { name: true } } } } },
              take: 1,
            },
          },
        },
        charge: { select: { category: { select: { label: true } } } },
        allocations: {
          where: { payment: { status: "VALIDATED" } },
          select: { amount: true },
        },
      },
      orderBy: { dueDate: "asc" },
    }),
    prisma.feeDiscount.findMany({
      where: {
        schoolId: ctx.schoolId,
        academicYearId: input.academicYearId,
        status: "ACTIVE",
      },
      select: { studentId: true, type: true, value: true },
    }),
  ]);

  // Total des charges par élève (base des remises en %)
  const totalByStudent = new Map<string, number>();
  for (const i of installments) {
    totalByStudent.set(i.student.id, (totalByStudent.get(i.student.id) ?? 0) + i.amount);
  }
  // Enveloppe de réduction restante par élève, consommée FIFO
  const discountPool = new Map<string, number>();
  for (const d of discounts) {
    const total = totalByStudent.get(d.studentId) ?? 0;
    const amount =
      d.type === "EXEMPTION"
        ? total
        : d.type === "PERCENT"
          ? Math.floor((total * d.value) / 100)
          : d.value;
    discountPool.set(d.studentId, (discountPool.get(d.studentId) ?? 0) + amount);
  }

  return installments
    .map((i) => {
      const paid = i.allocations.reduce((s, a) => s + a.amount, 0);
      let remaining = Math.max(0, i.amount - paid);
      // Consommation de l'enveloppe de réduction de l'élève (FIFO)
      const pool = discountPool.get(i.student.id) ?? 0;
      if (pool > 0 && remaining > 0) {
        const applied = Math.min(pool, remaining);
        remaining -= applied;
        discountPool.set(i.student.id, pool - applied);
      }
      const daysLate = Math.max(
        0,
        Math.floor((today.getTime() - i.dueDate.getTime()) / 86400000),
      );
      return {
        id: i.id,
        student: i.student,
        classroomName: i.student.enrollments[0]?.classroom.name ?? null,
        levelName: i.student.enrollments[0]?.classroom.level?.name ?? null,
        category: i.charge.category.label,
        label: i.label,
        dueDate: i.dueDate,
        amount: i.amount,
        paid,
        remaining,
        daysLate,
        exigible: i.dueDate < today,
        late: i.dueDate < today && remaining > 0,
      };
    })
    .filter((i) => i.remaining > 0);
}

/** Relance interne (notification aux comptes élève + tuteurs) — aucun envoi externe. */
export async function remindUnpaid(
  ctx: SchoolCtx,
  input: { studentId: string; installmentId?: string; note: string },
): Promise<PaymentsResult> {
  if (!input.note.trim()) return { ok: false, error: "INVALID_INPUT" };
  const student = await prisma.student.findFirst({
    where: { id: input.studentId, schoolId: ctx.schoolId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!student) return { ok: false, error: "NOT_FOUND" };

  await prisma.feeReminder.create({
    data: {
      schoolId: ctx.schoolId,
      studentId: input.studentId,
      installmentId: input.installmentId ?? null,
      note: input.note.trim(),
      createdById: ctx.userId,
    },
  });

  const links = await prisma.studentGuardian.findMany({
    where: { schoolId: ctx.schoolId, studentId: input.studentId },
    select: { guardian: { select: { user: { select: { id: true, status: true } } } } },
  });
  const studentUser = await prisma.student.findUnique({
    where: { id: input.studentId },
    select: { user: { select: { id: true, status: true } } },
  });
  const userIds = links
    .map((l) => l.guardian.user)
    .concat(studentUser?.user ? [studentUser.user] : [])
    .flatMap((u) => (u !== null && u.status === "ACTIVE" ? [u.id] : []));

  await notifyUsers({
    schoolId: ctx.schoolId,
    userIds,
    type: "FINANCE_REMINDER",
    title: "Rappel de paiement",
    body: input.note.trim(),
    link: "/parent?tab=finances",
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "finance.reminder.create",
    entity: "FeeReminder",
    entityId: input.studentId,
    metadata: { installmentId: input.installmentId },
  });
  return { ok: true, result: undefined };
}

export async function listReminders(ctx: SchoolCtx, studentId?: string) {
  return prisma.feeReminder.findMany({
    where: { schoolId: ctx.schoolId, ...(studentId ? { studentId } : {}) },
    include: {
      student: { select: { matricule: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

// ---------- Dashboard ----------

export async function financeDashboard(
  ctx: SchoolCtx,
  input: { academicYearId: string },
) {
  const year = await prisma.academicYear.findFirst({
    where: { id: input.academicYearId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!year) return null;

  const [charges, discounts, payments] = await Promise.all([
    prisma.studentFeeCharge.groupBy({
      by: ["categoryId"],
      where: { schoolId: ctx.schoolId, academicYearId: year.id, status: "ACTIVE" },
      _sum: { amount: true },
    }),
    prisma.feeDiscount.findMany({
      where: { schoolId: ctx.schoolId, academicYearId: year.id, status: "ACTIVE" },
      select: { type: true, value: true },
    }),
    prisma.payment.groupBy({
      by: ["method"],
      where: { schoolId: ctx.schoolId, academicYearId: year.id, status: "VALIDATED" },
      _sum: { amount: true },
    }),
  ]);

  const totalCharges = charges.reduce((s, c) => s + (c._sum.amount ?? 0), 0);
  const discountAmount = discounts.reduce(
    (s, d) =>
      s + (d.type === "PERCENT" ? Math.floor((totalCharges * d.value) / 100) : d.type === "EXEMPTION" ? totalCharges : d.value),
    0,
  );
  const totalPaid = payments.reduce((s, p) => s + (p._sum.amount ?? 0), 0);

  const today = new Date();
  const { start: dayStart, end: dayEnd } = dayBounds(today);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const sixMonthsAgo = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1),
  );
  const [todaySum, monthSum, lateInstallments, paidDates] = await Promise.all([
    prisma.payment.aggregate({
      where: {
        schoolId: ctx.schoolId,
        academicYearId: year.id,
        status: "VALIDATED",
        paidAt: { gte: dayStart, lt: dayEnd },
      },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: {
        schoolId: ctx.schoolId,
        academicYearId: year.id,
        status: "VALIDATED",
        paidAt: { gte: monthStart },
      },
      _sum: { amount: true },
    }),
    prisma.feeInstallment.findMany({
      where: {
        schoolId: ctx.schoolId,
        academicYearId: year.id,
        status: "ACTIVE",
        charge: { status: "ACTIVE" },
        dueDate: { lt: today },
      },
      include: {
        allocations: {
          where: { payment: { status: "VALIDATED" } },
          select: { amount: true },
        },
      },
    }),
    prisma.payment.findMany({
      where: {
        schoolId: ctx.schoolId,
        academicYearId: year.id,
        status: "VALIDATED",
        paidAt: { gte: sixMonthsAgo },
      },
      select: { paidAt: true, amount: true },
    }),
  ]);
  const lateAmount = lateInstallments.reduce(
    (s, i) => s + Math.max(0, i.amount - i.allocations.reduce((x, a) => x + a.amount, 0)),
    0,
  );

  const categories = await prisma.feeCategory.findMany({
    where: { id: { in: charges.map((c) => c.categoryId) } },
    select: { id: true, label: true },
  });
  const catById = new Map(categories.map((c) => [c.id, c.label]));

  return {
    totalCharges,
    discounts: discountAmount,
    due: Math.max(0, totalCharges - discountAmount),
    paid: totalPaid,
    balance: Math.max(0, totalCharges - discountAmount) - totalPaid,
    paidToday: todaySum._sum.amount ?? 0,
    paidThisMonth: monthSum._sum.amount ?? 0,
    lateAmount,
    lateCount: lateInstallments.filter(
      (i) => i.amount - i.allocations.reduce((x, a) => x + a.amount, 0) > 0,
    ).length,
    byCategory: charges.map((c) => ({
      label: catById.get(c.categoryId) ?? c.categoryId,
      amount: c._sum.amount ?? 0,
    })),
    byMethod: payments.map((p) => ({
      method: p.method,
      amount: p._sum.amount ?? 0,
    })),
    paidByMonth: monthlySeries(
      paidDates.map((p) => ({ date: p.paidAt, value: p.amount })),
    ),
  };
}
