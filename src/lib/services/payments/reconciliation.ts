/**
 * G3-D — Rapprochement Mobile Money, commissions, reversements,
 * anomalies financières.
 *
 * Une PaymentReconciliation matérialise le lien traçable entre :
 *   intention (montant demandé) → confirmation prestataire
 *   → encaissement F3 → commission → net attendu → reversement.
 * Elle est créée pour TOUTE intention confirmée (sandbox compris —
 * le suivi est identique, seul l'encaissement réel diffère) et jamais
 * « rapprochée » sur la seule similitude des montants : seules des
 * références stables (reversement déclaré, identifiants) rattachent
 * une opération.
 *
 * Les anomalies vont dans PaymentDiscrepancy — file de traitement
 * administrative avec historique des décisions. AUCUNE correction
 * financière silencieuse : chaque action est auditée et notifiée.
 */
import { DiscrepancyType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { notifyUsers } from "@/lib/services/notifications";

type Ctx = { userId: string; schoolId: string };
type Res<T> = { ok: true; data: T } | { ok: false; error: string };
type Db = Prisma.TransactionClient | typeof prisma;

/** Délai avant de signaler un reversement attendu non déclaré. */
export const SETTLEMENT_GRACE_DAYS = 7;
/** Délai avant de signaler un remboursement exécuté non confirmé. */
export const REFUND_CONFIRM_GRACE_HOURS = 24;

// ─── Commission opérateur ───────────────────────────────────────────

/**
 * Commission contractuelle du fournisseur : fixe + proportionnelle
 * (points de base). Jamais de tarif inventé — tout vient du
 * paramétrage explicite du PaymentProvider.
 * - SCHOOL : la commission est déduite du reversement → net attendu = brut − frais.
 * - PAYER  : la commission est facturée au payeur en sus → l'école
 *            attend le brut intégral ; les frais restent tracés.
 */
export function computeProviderFee(
  provider: { feeFixed: number; feePercent: number; feeBearer: "SCHOOL" | "PAYER" },
  amount: number,
): { fee: number; netExpected: number } {
  const fee = provider.feeFixed + Math.round((amount * provider.feePercent) / 10000);
  const netExpected = provider.feeBearer === "SCHOOL" ? amount - fee : amount;
  return { fee, netExpected };
}

// ─── Anomalies ──────────────────────────────────────────────────────

/**
 * Enregistre une anomalie une seule fois par objet (dédupliquée par
 * type + cible tant qu'elle reste ouverte). Aucune correction — juste
 * la trace, la file de traitement décide.
 */
export async function ensureDiscrepancy(
  db: Db,
  input: {
    schoolId: string;
    type: DiscrepancyType;
    intentId?: string | null;
    paymentId?: string | null;
    settlementId?: string | null;
    refundId?: string | null;
    expectedAmount?: number | null;
    actualAmount?: number | null;
    description: string;
  },
): Promise<{ id: string; created: boolean }> {
  const key = {
    schoolId: input.schoolId,
    type: input.type,
    intentId: input.intentId ?? null,
    paymentId: input.paymentId ?? null,
    settlementId: input.settlementId ?? null,
    refundId: input.refundId ?? null,
  };
  const existing = await db.paymentDiscrepancy.findFirst({
    where: { ...key, status: { in: ["OPEN", "IN_REVIEW"] } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };
  const d = await db.paymentDiscrepancy.create({
    data: {
      ...key,
      expectedAmount: input.expectedAmount ?? null,
      actualAmount: input.actualAmount ?? null,
      description: input.description,
      history: [],
    },
    select: { id: true },
  });
  return { id: d.id, created: true };
}

/** Notifie les détenteurs de `mobilepayments.reconcile`. */
export async function notifyReconcileAdmins(
  schoolId: string,
  msg: { title: string; body?: string; link?: string },
) {
  const users = await prisma.schoolMembership.findMany({
    where: {
      schoolId,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      role: {
        scope: "SCHOOL",
        OR: [{ schoolId: null }, { schoolId }],
        rolePermissions: { some: { permission: { key: "mobilepayments.reconcile" } } },
      },
    },
    select: { userId: true },
  });
  if (users.length === 0) return;
  await notifyUsers({
    schoolId,
    userIds: users.map((u) => u.userId),
    type: "ADMIN_MESSAGE",
    title: msg.title,
    body: msg.body,
    link: msg.link ?? "/app/paiements-mobile",
  });
}

// ─── Rapprochements ─────────────────────────────────────────────────

/**
 * Crée le rapprochement d'une intention confirmée si absent.
 * Idempotent — rattrapé par `syncReconciliations` en cas d'échec.
 */
export async function ensureReconciliation(
  db: Db,
  intentId: string,
): Promise<void> {
  const intent = await db.paymentIntent.findUnique({
    where: { id: intentId },
    include: { provider: true },
  });
  if (!intent) return;
  if (intent.status !== "CONFIRMED" && intent.status !== "CONFIRMED_PENDING_POSTING") return;
  const existing = await db.paymentReconciliation.findUnique({
    where: { intentId },
    select: { id: true },
  });
  if (existing) return;
  const { fee, netExpected } = computeProviderFee(intent.provider, intent.amount);
  try {
    await db.paymentReconciliation.create({
      data: {
        schoolId: intent.schoolId,
        intentId: intent.id,
        providerId: intent.providerId,
        paymentId: intent.paymentId ?? null,
        academicYearId: intent.academicYearId,
        grossAmount: intent.amount,
        confirmedAmount: intent.confirmedAt ? intent.amount : null,
        feeAmount: fee,
        feeBearer: intent.provider.feeBearer,
        netExpected,
      },
    });
  } catch (e) {
    // Course concurrente : l'unicité intentId absorbe le doublon.
    if ((e as { code?: string })?.code !== "P2002") throw e;
  }
}

/**
 * Balayage : rapprochements manquants + anomalies détectables
 * automatiquement (confirmation tardive, confirmation sans
 * encaissement, encaissement sans confirmation, montant divergent).
 * `__includeSimulated` permet à la recette de vérifier les anomalies
 * sur les fixtures sandbox ; en production les intentions simulées
 * ne déclenchent pas CONFIRMED_NO_PAYMENT (elles ne postent jamais).
 */
export async function syncReconciliations(
  schoolId: string,
  opts: { __includeSimulated?: boolean } = {},
): Promise<{ created: number; anomalies: number }> {
  const intents = await prisma.paymentIntent.findMany({
    where: {
      schoolId,
      status: { in: ["CONFIRMED", "CONFIRMED_PENDING_POSTING"] },
    },
    include: {
      provider: true,
      transactions: { where: { kind: "CONFIRM" }, select: { payload: true } },
    },
    take: 500,
  });
  let created = 0;
  let anomalies = 0;
  const isSim = (i: (typeof intents)[number]) =>
    i.provider.mode === "SANDBOX" || i.provider.code === "SANDBOX" || i.sandboxScript != null;

  for (const i of intents) {
    const before = await prisma.paymentReconciliation.findUnique({
      where: { intentId: i.id },
      select: { id: true, paymentId: true },
    });
    if (!before) {
      await ensureReconciliation(prisma, i.id);
      created++;
    } else if (i.paymentId && !before.paymentId) {
      await prisma.paymentReconciliation.update({
        where: { id: before.id },
        data: { paymentId: i.paymentId },
      });
    }

    // Confirmation tardive : confirmation après l'expiration prévue.
    if (i.confirmedAt && i.expiresAt && i.confirmedAt > i.expiresAt) {
      const r = await ensureDiscrepancy(prisma, {
        schoolId,
        type: "LATE_CONFIRMATION",
        intentId: i.id,
        expectedAmount: i.amount,
        description: `Confirmation reçue après expiration (${i.confirmedAt.toISOString()} > ${i.expiresAt.toISOString()})`,
      });
      if (r.created) anomalies++;
    }

    // Montant divergent : une transaction CONFIRM transportant un
    // montant différent de celui de l'intention est un écart réel.
    for (const t of i.transactions) {
      const amt = (t.payload as { amount?: number } | null)?.amount;
      if (typeof amt === "number" && amt !== i.amount) {
        const r = await ensureDiscrepancy(prisma, {
          schoolId,
          type: "AMOUNT_MISMATCH",
          intentId: i.id,
          expectedAmount: i.amount,
          actualAmount: amt,
          description: `Montant confirmé par le prestataire (${amt}) ≠ montant demandé (${i.amount})`,
        });
        if (r.created) anomalies++;
      }
    }

    // Confirmation prestataire sans encaissement : état terminal
    // CONFIRMED sans paymentId (posting bloqué) ou en attente depuis
    // plus de 24 h — jamais pour les intentions simulées.
    const noPaymentStale =
      !i.paymentId &&
      (i.status === "CONFIRMED" ||
        (i.confirmedAt && Date.now() - i.confirmedAt.getTime() > 24 * 3600 * 1000));
    if (noPaymentStale && (!isSim(i) || opts.__includeSimulated)) {
      const r = await ensureDiscrepancy(prisma, {
        schoolId,
        type: "CONFIRMED_NO_PAYMENT",
        intentId: i.id,
        expectedAmount: i.amount,
        description: `Confirmation prestataire sans encaissement associé (statut ${i.status})`,
      });
      if (r.created) anomalies++;
    }
  }

  // Encaissement MOBILE_MONEY sans confirmation prestataire.
  const orphanPayments = await prisma.payment.findMany({
    where: { schoolId, method: "MOBILE_MONEY", status: "VALIDATED", intent: null },
    select: { id: true, amount: true },
    take: 200,
  });
  for (const p of orphanPayments) {
    const r = await ensureDiscrepancy(prisma, {
      schoolId,
      type: "PAYMENT_NO_CONFIRM",
      paymentId: p.id,
      actualAmount: p.amount,
      description: `Encaissement Mobile Money sans intention/confirmation associée (${p.amount} XOF)`,
    });
    if (r.created) anomalies++;
  }

  return { created, anomalies };
}

/** Reversements attendus non déclarés après le délai de grâce. */
export async function flagMissingSettlements(
  schoolId: string,
  opts: { graceDays?: number; asOf?: Date } = {},
): Promise<number> {
  const grace = (opts.graceDays ?? SETTLEMENT_GRACE_DAYS) * 24 * 3600 * 1000;
  const cutoff = new Date((opts.asOf ?? new Date()).getTime() - grace);
  const pending = await prisma.paymentReconciliation.findMany({
    where: {
      schoolId,
      status: "PENDING",
      settlementId: null,
      intent: { confirmedAt: { lt: cutoff }, status: { in: ["CONFIRMED", "CONFIRMED_PENDING_POSTING"] } },
    },
    select: { id: true, intentId: true, netExpected: true },
  });
  let n = 0;
  for (const r of pending) {
    const d = await ensureDiscrepancy(prisma, {
      schoolId,
      type: "SETTLEMENT_MISSING",
      intentId: r.intentId,
      expectedAmount: r.netExpected,
      description: `Reversement attendu non déclaré après ${opts.graceDays ?? SETTLEMENT_GRACE_DAYS} j`,
    });
    if (d.created) n++;
  }
  return n;
}

/** Remboursements exécutés restés sans confirmation. */
export async function flagUnconfirmedRefunds(
  schoolId: string,
  opts: { graceHours?: number; asOf?: Date } = {},
): Promise<number> {
  const grace = (opts.graceHours ?? REFUND_CONFIRM_GRACE_HOURS) * 3600 * 1000;
  const cutoff = new Date((opts.asOf ?? new Date()).getTime() - grace);
  const stale = await prisma.paymentRefund.findMany({
    where: { schoolId, status: "EXECUTED", executedAt: { lt: cutoff } },
    select: { id: true, amount: true },
  });
  let n = 0;
  for (const r of stale) {
    const d = await ensureDiscrepancy(prisma, {
      schoolId,
      type: "REFUND_UNCONFIRMED",
      refundId: r.id,
      actualAmount: r.amount,
      description: `Remboursement exécuté (simulation) non confirmé après ${opts.graceHours ?? REFUND_CONFIRM_GRACE_HOURS} h`,
    });
    if (d.created) n++;
  }
  return n;
}

export async function listReconciliations(
  ctx: { schoolId: string },
  filter: { status?: string; providerId?: string; limit?: number } = {},
) {
  return prisma.paymentReconciliation.findMany({
    where: {
      schoolId: ctx.schoolId,
      status: (filter.status as never) ?? undefined,
      providerId: filter.providerId || undefined,
    },
    include: {
      provider: { select: { code: true, label: true, mode: true } },
      intent: {
        select: {
          id: true, amount: true, currency: true, status: true,
          confirmedAt: true, providerTxId: true, providerRef: true,
          student: { select: { matricule: true, firstName: true, lastName: true } },
        },
      },
      payment: { select: { id: true, receiptNumber: true, status: true } },
      settlement: { select: { id: true, reference: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(filter.limit ?? 200, 500),
  });
}

/**
 * Décision administrative sur un rapprochement : passage à vérifier,
 * marquage rapproché (après contrôle humain des références) ou
 * clôture. Jamais automatique sur la seule similitude des montants.
 */
export async function verifyReconciliation(
  ctx: Ctx,
  id: string,
  input: { action: "TO_VERIFY" | "MATCHED" | "RESOLVED"; note?: string },
): Promise<Res<{ status: string }>> {
  const rec = await prisma.paymentReconciliation.findFirst({
    where: { id, schoolId: ctx.schoolId },
  });
  if (!rec) return { ok: false, error: "NOT_FOUND" };
  if ((input.action === "RESOLVED" || input.action === "MATCHED") && !input.note?.trim()) {
    return { ok: false, error: "NOTE_REQUIRED" };
  }
  const upd = await prisma.paymentReconciliation.updateMany({
    where: { id: rec.id, status: rec.status },
    data: {
      status: input.action,
      checkedById: ctx.userId,
      checkedAt: new Date(),
      notes: input.note?.trim() ? `${input.note.trim()}` : rec.notes,
    },
  });
  if (upd.count === 0) return { ok: false, error: "CONCURRENT" };
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: `payment_reconciliation.${input.action.toLowerCase()}`,
    entity: "PaymentReconciliation",
    entityId: rec.id,
    metadata: { intentId: rec.intentId, note: input.note ?? null },
  });
  return { ok: true, data: { status: input.action } };
}

// ─── Reversements ───────────────────────────────────────────────────

/**
 * Déclare un reversement groupé (référence prestataire ou relevé).
 * Une déclaration administrative n'est PAS une preuve bancaire —
 * `declared: true` le signale. Rattache les rapprochements de la
 * période non encore couverts, calcule les écarts :
 *   net déclaré = net attendu → MATCHED (rapprochements MATCHED)
 *   net déclaré < net attendu → PARTIAL + anomalie
 *   net déclaré > net attendu → DISCREPANCY + anomalie
 *   aucune opération couverte  → DECLARED + anomalie UNKNOWN_REFERENCE
 * Idempotent par (école, prestataire, référence) : un doublon renvoie
 * DUPLICATE_REFERENCE et trace l'anomalie.
 */
export async function declareSettlement(
  ctx: Ctx,
  input: {
    providerId: string;
    reference: string;
    periodStart: Date;
    periodEnd: Date;
    netDeclared?: number | null;
    receivedAt?: Date | null;
    notes?: string;
  },
): Promise<Res<{ id: string; status: string; covered: number }>> {
  const reference = input.reference.trim();
  if (!reference || reference.length > 120) return { ok: false, error: "INVALID_INPUT" };
  if (!(input.periodStart instanceof Date) || !(input.periodEnd instanceof Date) ||
      input.periodStart > input.periodEnd) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (input.netDeclared != null && (!Number.isInteger(input.netDeclared) || input.netDeclared < 0)) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const provider = await prisma.paymentProvider.findFirst({
    where: { id: input.providerId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!provider) return { ok: false, error: "NOT_FOUND" };

  // Référence unique par école/prestataire — jamais de doublon silencieux.
  const dupe = await prisma.paymentSettlement.findFirst({
    where: { schoolId: ctx.schoolId, providerId: provider.id, reference },
    select: { id: true },
  });
  if (dupe) {
    await ensureDiscrepancy(prisma, {
      schoolId: ctx.schoolId,
      type: "DUPLICATE_REFERENCE",
      settlementId: dupe.id,
      description: `Référence de reversement « ${reference} » déclarée une seconde fois`,
    });
    return { ok: false, error: "DUPLICATE_REFERENCE" };
  }

  // Opérations rapprochables : confirmées dans la période, non couvertes.
  const candidates = await prisma.paymentReconciliation.findMany({
    where: {
      schoolId: ctx.schoolId,
      providerId: provider.id,
      settlementId: null,
      status: { in: ["PENDING", "TO_VERIFY", "DISCREPANCY"] },
      intent: { confirmedAt: { gte: input.periodStart, lte: input.periodEnd } },
    },
    select: { id: true, grossAmount: true, feeAmount: true, netExpected: true },
  });
  const grossTotal = candidates.reduce((s, r) => s + r.grossAmount, 0);
  const feeTotal = candidates.reduce((s, r) => s + r.feeAmount, 0);
  const netExpected = candidates.reduce((s, r) => s + r.netExpected, 0);

  let status: "DECLARED" | "MATCHED" | "PARTIAL" | "DISCREPANCY";
  if (input.netDeclared == null) status = "DECLARED";
  else if (input.netDeclared === netExpected) status = "MATCHED";
  else if (input.netDeclared < netExpected) status = "PARTIAL";
  else status = "DISCREPANCY";

  const settlement = await prisma.$transaction(async (tx) => {
    const s = await tx.paymentSettlement.create({
      data: {
        schoolId: ctx.schoolId,
        providerId: provider.id,
        reference,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        grossTotal,
        feeTotal,
        netExpected,
        netDeclared: input.netDeclared ?? null,
        receivedAt: input.receivedAt ?? null,
        status,
        declared: true,
        declaredById: ctx.userId,
        notes: input.notes?.trim() || null,
      },
    });
    if (candidates.length) {
      await tx.paymentReconciliation.updateMany({
        where: { id: { in: candidates.map((c) => c.id) }, settlementId: null },
        data: {
          settlementId: s.id,
          status: status === "MATCHED" ? "MATCHED" : status === "DECLARED" ? "PENDING" : "TO_VERIFY",
        },
      });
    }
    return s;
  });

  // Anomalies — jamais de correction silencieuse.
  if (candidates.length === 0) {
    await ensureDiscrepancy(prisma, {
      schoolId: ctx.schoolId,
      type: "UNKNOWN_REFERENCE",
      settlementId: settlement.id,
      description: `Reversement « ${reference} » : aucune opération rapprochée sur la période`,
    });
  }
  if (status === "PARTIAL") {
    await ensureDiscrepancy(prisma, {
      schoolId: ctx.schoolId,
      type: "SETTLEMENT_PARTIAL",
      settlementId: settlement.id,
      expectedAmount: netExpected,
      actualAmount: input.netDeclared,
      description: `Reversement partiel : déclaré ${input.netDeclared} < attendu ${netExpected}`,
    });
  }
  if (status === "DISCREPANCY") {
    await ensureDiscrepancy(prisma, {
      schoolId: ctx.schoolId,
      type: "SETTLEMENT_MISMATCH",
      settlementId: settlement.id,
      expectedAmount: netExpected,
      actualAmount: input.netDeclared,
      description: `Écart de reversement : déclaré ${input.netDeclared} ≠ attendu ${netExpected}`,
    });
  }
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "payment_settlement.declared",
    entity: "PaymentSettlement",
    entityId: settlement.id,
    metadata: {
      reference,
      covered: candidates.length,
      grossTotal,
      feeTotal,
      netExpected,
      netDeclared: input.netDeclared ?? null,
      status,
    },
  });
  if (status !== "MATCHED") {
    await notifyReconcileAdmins(ctx.schoolId, {
      title: `Reversement Mobile Money ${status === "DECLARED" ? "déclaré" : "en écart"}`,
      body: `Réf. ${reference} — attendu ${netExpected} XOF, déclaré ${input.netDeclared ?? "—"}`,
      link: "/app/paiements-mobile?tab=reversements",
    });
  }
  return { ok: true, data: { id: settlement.id, status, covered: candidates.length } };
}

/** Clôture un reversement déclaré en marquant le net effectivement reçu. */
export async function completeSettlement(
  ctx: Ctx,
  id: string,
  input: { netDeclared: number; receivedAt?: Date | null; notes?: string },
): Promise<Res<{ status: string }>> {
  if (!Number.isInteger(input.netDeclared) || input.netDeclared < 0) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const s = await prisma.paymentSettlement.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true, status: true, netExpected: true, reference: true },
  });
  if (!s) return { ok: false, error: "NOT_FOUND" };
  if (s.status !== "DECLARED") return { ok: false, error: "INVALID_STATE" };

  const status =
    input.netDeclared === s.netExpected ? "MATCHED"
    : input.netDeclared < s.netExpected ? "PARTIAL"
    : "DISCREPANCY";
  await prisma.$transaction(async (tx) => {
    await tx.paymentSettlement.update({
      where: { id: s.id },
      data: {
        netDeclared: input.netDeclared,
        receivedAt: input.receivedAt ?? new Date(),
        status,
        notes: input.notes?.trim() || undefined,
      },
    });
    await tx.paymentReconciliation.updateMany({
      where: { settlementId: s.id },
      data: { status: status === "MATCHED" ? "MATCHED" : "TO_VERIFY" },
    });
  });
  if (status !== "MATCHED") {
    await ensureDiscrepancy(prisma, {
      schoolId: ctx.schoolId,
      type: status === "PARTIAL" ? "SETTLEMENT_PARTIAL" : "SETTLEMENT_MISMATCH",
      settlementId: s.id,
      expectedAmount: s.netExpected,
      actualAmount: input.netDeclared,
      description: `Reversement « ${s.reference} » : déclaré ${input.netDeclared} ≠ attendu ${s.netExpected}`,
    });
  }
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "payment_settlement.completed",
    entity: "PaymentSettlement",
    entityId: s.id,
    metadata: { netDeclared: input.netDeclared, status },
  });
  return { ok: true, data: { status } };
}

export async function listSettlements(
  ctx: { schoolId: string },
  filter: { status?: string; providerId?: string; limit?: number } = {},
) {
  return prisma.paymentSettlement.findMany({
    where: {
      schoolId: ctx.schoolId,
      status: (filter.status as never) ?? undefined,
      providerId: filter.providerId || undefined,
    },
    include: {
      provider: { select: { code: true, label: true } },
      _count: { select: { reconciliations: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(filter.limit ?? 100, 300),
  });
}

// ─── File d'anomalies ───────────────────────────────────────────────

export async function listDiscrepancies(
  ctx: { schoolId: string },
  filter: { status?: string; type?: string; limit?: number } = {},
) {
  return prisma.paymentDiscrepancy.findMany({
    where: {
      schoolId: ctx.schoolId,
      status: (filter.status as never) ?? undefined,
      type: (filter.type as never) ?? undefined,
    },
    include: {
      intent: { select: { id: true, amount: true, status: true, providerTxId: true } },
      settlement: { select: { id: true, reference: true } },
      refund: { select: { id: true, amount: true, status: true } },
      resolvedBy: { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: Math.min(filter.limit ?? 200, 500),
  });
}

/**
 * Décision sur une anomalie : prise en charge, résolution ou classement
 * sans suite — toujours avec motif, acteur et horodatage dans
 * `history`. Aucune correction financière automatique.
 */
export async function decideDiscrepancy(
  ctx: Ctx,
  id: string,
  input: { action: "IN_REVIEW" | "RESOLVED" | "IGNORED"; note: string },
): Promise<Res<{ status: string }>> {
  if (!input.note?.trim()) return { ok: false, error: "NOTE_REQUIRED" };
  const d = await prisma.paymentDiscrepancy.findFirst({
    where: { id, schoolId: ctx.schoolId },
  });
  if (!d) return { ok: false, error: "NOT_FOUND" };
  if (d.status === "RESOLVED" || d.status === "IGNORED") {
    return { ok: false, error: "INVALID_STATE" };
  }
  const history = [
    ...((d.history as { at: string; by: string; action: string; note: string }[] | null) ?? []),
    { at: new Date().toISOString(), by: ctx.userId, action: input.action, note: input.note.trim() },
  ];
  const terminal = input.action === "RESOLVED" || input.action === "IGNORED";
  const upd = await prisma.paymentDiscrepancy.updateMany({
    where: { id: d.id, status: d.status },
    data: {
      status: input.action,
      history,
      resolvedById: terminal ? ctx.userId : d.resolvedById,
      resolvedAt: terminal ? new Date() : d.resolvedAt,
      resolutionNotes: terminal ? input.note.trim() : d.resolutionNotes,
    },
  });
  if (upd.count === 0) return { ok: false, error: "CONCURRENT" };
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: `payment_discrepancy.${input.action.toLowerCase()}`,
    entity: "PaymentDiscrepancy",
    entityId: d.id,
    metadata: { type: d.type, note: input.note.trim() },
  });
  return { ok: true, data: { status: input.action } };
}
