import { prisma } from "@/lib/db/prisma";

const MONTHS_FR = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];

/**
 * Série mensuelle sur les N derniers mois (labels FR courts).
 * `rows` : { date, value? } — value = 1 par défaut (comptage) ou montant.
 */
export function monthlySeries(
  rows: { date: Date; value?: number }[],
  months = 6,
  range?: { from: Date; to: Date },
): { label: string; value: number }[] {
  const now = new Date();
  const buckets: { key: string; label: string; value: number }[] = [];
  if (range) {
    const d = new Date(
      Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), 1),
    );
    const end = new Date(
      Date.UTC(range.to.getUTCFullYear(), range.to.getUTCMonth(), 1),
    );
    while (d <= end && buckets.length < 14) {
      buckets.push({
        key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`,
        label: MONTHS_FR[d.getUTCMonth()],
        value: 0,
      });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  } else {
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      buckets.push({
        key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`,
        label: MONTHS_FR[d.getUTCMonth()],
        value: 0,
      });
    }
  }
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  for (const row of rows) {
    const i = index.get(`${row.date.getUTCFullYear()}-${row.date.getUTCMonth()}`);
    if (i !== undefined) buckets[i].value += row.value ?? 1;
  }
  return buckets.map(({ label, value }) => ({ label, value }));
}

/** Indicateurs commerciaux réels de la plateforme. */
export async function platformDashboard() {
  const now = new Date();
  const in30d = new Date(now.getTime() + 30 * 86400000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const sixMonthsAgo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1),
  );

  const [
    totalSchools,
    activeSchools,
    byStatus,
    byPlan,
    invoiced,
    collected,
    unpaidInvoices,
    activeSubs,
    renewals,
    pendingRequests,
    pendingSignupRequests,
    schoolsDates,
    paymentsDates,
    requestsDates,
  ] = await Promise.all([
    prisma.school.count(),
    prisma.school.count({ where: { status: "ACTIVE" } }),
    prisma.schoolSubscription.groupBy({ by: ["status"], _count: true }),
    prisma.schoolSubscription.groupBy({
      by: ["planId"],
      where: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE"] } },
      _count: true,
    }),
    prisma.platformInvoice.aggregate({
      where: { status: { not: "CANCELLED" } },
      _sum: { total: true },
    }),
    prisma.platformPayment.aggregate({
      where: { status: "VALIDATED" },
      _sum: { amount: true },
    }),
    prisma.platformInvoice.findMany({
      where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: now } },
      include: {
        payments: { where: { status: "VALIDATED" }, select: { amount: true } },
        creditNotes: { select: { amount: true } },
      },
    }),
    prisma.schoolSubscription.findMany({
      where: { status: { in: ["TRIALING", "ACTIVE"] } },
      include: { plan: true },
    }),
    prisma.schoolSubscription.findMany({
      where: {
        status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE"] },
        currentPeriodEnd: { gte: now, lte: in30d },
      },
      include: {
        school: { select: { name: true, code: true } },
        plan: { select: { name: true } },
      },
      orderBy: { currentPeriodEnd: "asc" },
      take: 20,
    }),
    prisma.subscriptionChangeRequest.count({ where: { status: "PENDING" } }),
    prisma.schoolSignupRequest.count({
      where: { status: { in: ["PENDING", "CONTACTED"] } },
    }),
    prisma.school.findMany({
      where: { createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true },
    }),
    prisma.platformPayment.findMany({
      where: { status: "VALIDATED", paidAt: { gte: sixMonthsAgo } },
      select: { paidAt: true, amount: true },
    }),
    prisma.schoolSignupRequest.findMany({
      where: { createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true },
    }),
  ]);

  const unpaid = unpaidInvoices.reduce((s, i) => {
    const paid = i.payments.reduce((x, p) => x + p.amount, 0);
    const credited = i.creditNotes.reduce((x, c) => x + c.amount, 0);
    return s + Math.max(0, i.total - paid - credited);
  }, 0);

  // MRR : équivalent mensuel des abonnements actifs (hors essai)
  const mrr = activeSubs
    .filter((s) => s.status === "ACTIVE")
    .reduce(
      (s, sub) =>
        s +
        (sub.cycle === "YEARLY"
          ? Math.floor(sub.plan.yearlyPrice / 12)
          : sub.plan.monthlyPrice),
      0,
    );

  const collectedThisMonth = await prisma.platformPayment.aggregate({
    where: { status: "VALIDATED", paidAt: { gte: monthStart } },
    _sum: { amount: true },
  });

  const planNames = await prisma.subscriptionPlan.findMany({
    where: { id: { in: byPlan.map((b) => b.planId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(planNames.map((p) => [p.id, p.name]));

  return {
    totalSchools,
    activeSchools,
    trialing: byStatus.find((s) => s.status === "TRIALING")?._count ?? 0,
    active: byStatus.find((s) => s.status === "ACTIVE")?._count ?? 0,
    pastDue: byStatus.find((s) => s.status === "PAST_DUE")?._count ?? 0,
    grace: byStatus.find((s) => s.status === "GRACE")?._count ?? 0,
    suspended: byStatus.find((s) => s.status === "SUSPENDED")?._count ?? 0,
    expired: byStatus.find((s) => s.status === "EXPIRED")?._count ?? 0,
    byPlan: byPlan.map((b) => ({ plan: nameById.get(b.planId) ?? b.planId, count: b._count })),
    invoicedTotal: invoiced._sum.total ?? 0,
    collectedTotal: collected._sum.amount ?? 0,
    collectedThisMonth: collectedThisMonth._sum.amount ?? 0,
    unpaidTotal: unpaid,
    unpaidCount: unpaidInvoices.length,
    mrr,
    renewals,
    pendingRequests,
    pendingSignupRequests,
    // Séries mensuelles (6 derniers mois) — données réelles.
    schoolsByMonth: monthlySeries(
      schoolsDates.map((s) => ({ date: s.createdAt })),
    ),
    collectedByMonth: monthlySeries(
      paymentsDates.map((p) => ({ date: p.paidAt, value: p.amount })),
    ),
    requestsByMonth: monthlySeries(
      requestsDates.map((r) => ({ date: r.createdAt })),
    ),
  };
}
