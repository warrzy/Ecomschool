import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import type { BillingCycle, PlatformInvoiceStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";

export type BillingError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "INVALID_STATUS"
  | "CLOSED"
  | "CREATE_FAILED";

export type BillingResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: BillingError };

async function platformConfig() {
  return prisma.platformConfig.upsert({
    where: { id: "platform" },
    update: {},
    create: { id: "platform" },
  });
}

/** Numérotation unique INV-YYYY-##### (transaction Serializable + retry). */
async function nextInvoiceNumber() {
  const year = new Date().getUTCFullYear();
  const count = await prisma.platformInvoice.count({
    where: { invoiceNumber: { startsWith: `INV-${year}-` } },
  });
  return `INV-${year}-${String(count + 1).padStart(5, "0")}`;
}

function invoiceSnapshot(params: {
  invoiceNumber: string;
  school: { name: string; code: string; address: string | null; city: string | null };
  config: Awaited<ReturnType<typeof platformConfig>>;
  lines: { label: string; quantity: number; unitPrice: number; amount: number }[];
  total: number;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
  cycle: BillingCycle;
  planName?: string | null;
}) {
  const p = params;
  return {
    invoiceNumber: p.invoiceNumber,
    issuer: {
      legalName: p.config.legalName ?? "ECOM-TOUCH",
      address: p.config.address,
      city: p.config.city,
      country: p.config.country ?? "Burkina Faso",
      phone: p.config.phone,
      email: p.config.email,
      taxId: p.config.taxId,
    },
    customer: p.school,
    lines: p.lines,
    total: p.total,
    currency: p.currency,
    issueDate: p.issueDate.toISOString(),
    dueDate: p.dueDate.toISOString(),
    periodStart: p.periodStart?.toISOString() ?? null,
    periodEnd: p.periodEnd?.toISOString() ?? null,
    cycle: p.cycle,
    planName: p.planName ?? null,
    footer: p.config.invoiceFooter,
  };
}

/** Génère une facture : lignes explicites ou prix de l'offre courante. */
export async function generateInvoice(
  actorUserId: string,
  input: {
    schoolId: string;
    subscriptionId?: string;
    cycle?: BillingCycle;
    dueDate?: Date;
    lines?: { label: string; quantity?: number; unitPrice: number }[];
  },
): Promise<BillingResult<{ id: string; invoiceNumber: string }>> {
  const school = await prisma.school.findUnique({
    where: { id: input.schoolId },
    select: { id: true, name: true, code: true, address: true, city: true },
  });
  if (!school) return { ok: false, error: "NOT_FOUND" };

  const sub = input.subscriptionId
    ? await prisma.schoolSubscription.findFirst({
        where: { id: input.subscriptionId, schoolId: input.schoolId },
        include: { plan: true },
      })
    : await prisma.schoolSubscription.findFirst({
        where: { schoolId: input.schoolId, status: { notIn: ["CANCELLED", "EXPIRED"] } },
        include: { plan: true },
        orderBy: { createdAt: "desc" },
      });

  const cycle = input.cycle ?? sub?.cycle ?? "MONTHLY";
  let lines = (input.lines ?? []).map((l) => {
    const qty = Math.max(1, l.quantity ?? 1);
    return { label: l.label.trim(), quantity: qty, unitPrice: l.unitPrice, amount: qty * l.unitPrice };
  });
  if (lines.length === 0 && sub) {
    const amount = cycle === "YEARLY" ? sub.plan.yearlyPrice : sub.plan.monthlyPrice;
    lines = [
      {
        label: `Abonnement ${sub.plan.name} — ${cycle === "YEARLY" ? "annuel" : "mensuel"}`,
        quantity: 1,
        unitPrice: amount,
        amount,
      },
    ];
  }
  if (lines.length === 0 || lines.some((l) => !l.label || l.unitPrice < 0)) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const issueDate = new Date();
  const dueDate = input.dueDate ?? new Date(issueDate.getTime() + 15 * 86400000);
  const config = await platformConfig();

  try {
    let invoice: { id: string; invoiceNumber: string } | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4 && !invoice; attempt++) {
      const invoiceNumber = await nextInvoiceNumber();
      try {
        invoice = await prisma.platformInvoice.create({
          data: {
            invoiceNumber,
            schoolId: input.schoolId,
            subscriptionId: sub?.id ?? null,
            cycle,
            issueDate,
            dueDate,
            periodStart: sub?.currentPeriodStart ?? null,
            periodEnd: sub?.currentPeriodEnd ?? null,
            total,
            createdById: actorUserId,
            snapshot: invoiceSnapshot({
              invoiceNumber,
              school,
              config,
              lines,
              total,
              currency: "XOF",
              issueDate,
              dueDate,
              periodStart: sub?.currentPeriodStart ?? null,
              periodEnd: sub?.currentPeriodEnd ?? null,
              cycle,
              planName: sub?.plan.name ?? null,
            }),
            lines: { create: lines },
          },
          select: { id: true, invoiceNumber: true },
        });
      } catch (e) {
        lastError = e;
        if ((e as { code?: string })?.code !== "P2002") throw e;
      }
    }
    if (!invoice) throw lastError;

    await logAudit({
      actorId: actorUserId,
      schoolId: input.schoolId,
      action: "platform.invoice.create",
      entity: "PlatformInvoice",
      entityId: invoice.id,
      metadata: { invoiceNumber: invoice.invoiceNumber, total },
    });
    return { ok: true, result: invoice };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

/** Recalcule le statut d'une facture depuis ses règlements et avoirs. */
async function recomputeInvoiceStatus(invoiceId: string) {
  const inv = await prisma.platformInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      total: true,
      status: true,
      payments: { where: { status: "VALIDATED" }, select: { amount: true } },
      creditNotes: { select: { amount: true } },
    },
  });
  if (!inv || inv.status === "CANCELLED") return;
  const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
  const credited = inv.creditNotes.reduce((s, c) => s + c.amount, 0);
  const remaining = inv.total - paid - credited;
  const status: PlatformInvoiceStatus =
    remaining <= 0 ? "PAID" : paid + credited > 0 ? "PARTIALLY_PAID" : "ISSUED";
  await prisma.platformInvoice.update({ where: { id: invoiceId }, data: { status } });
}

export async function recordPlatformPayment(
  actorUserId: string,
  input: {
    invoiceId: string;
    amount: number;
    method?: string;
    paidAt?: Date;
    reference?: string;
    observation?: string;
    idempotencyKey?: string;
  },
): Promise<BillingResult<{ id: string }>> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const inv = await prisma.platformInvoice.findUnique({
    where: { id: input.invoiceId },
    select: { id: true, schoolId: true, status: true },
  });
  if (!inv) return { ok: false, error: "NOT_FOUND" };
  if (inv.status === "CANCELLED" || inv.status === "PAID") {
    return { ok: false, error: "INVALID_STATUS" };
  }

  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  if (input.idempotencyKey) {
    const existing = await prisma.platformPayment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (existing) return { ok: true, result: existing };
  }

  try {
    const payment = await prisma.platformPayment.create({
      data: {
        invoiceId: inv.id,
        schoolId: inv.schoolId,
        amount: input.amount,
        paidAt: input.paidAt ?? new Date(),
        method: input.method?.trim() || null,
        reference: input.reference?.trim() || null,
        observation: input.observation?.trim() || null,
        receivedById: actorUserId,
        idempotencyKey,
      },
      select: { id: true },
    });
    await recomputeInvoiceStatus(inv.id);
    await logAudit({
      actorId: actorUserId,
      schoolId: inv.schoolId,
      action: "platform.payment.create",
      entity: "PlatformPayment",
      entityId: payment.id,
      metadata: { invoiceId: inv.id, amount: input.amount },
    });
    return { ok: true, result: payment };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function cancelPlatformPayment(
  actorUserId: string,
  input: { paymentId: string; reason: string },
): Promise<BillingResult> {
  if (!input.reason.trim()) return { ok: false, error: "INVALID_INPUT" };
  const p = await prisma.platformPayment.findUnique({
    where: { id: input.paymentId },
    select: { id: true, status: true, invoiceId: true, schoolId: true },
  });
  if (!p) return { ok: false, error: "NOT_FOUND" };
  if (p.status === "CANCELLED") return { ok: false, error: "INVALID_STATUS" };
  await prisma.platformPayment.update({
    where: { id: p.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledById: actorUserId,
      cancelReason: input.reason.trim(),
    },
  });
  await recomputeInvoiceStatus(p.invoiceId);
  await logAudit({
    actorId: actorUserId,
    schoolId: p.schoolId,
    action: "platform.payment.cancel",
    entity: "PlatformPayment",
    entityId: p.id,
    metadata: { reason: input.reason },
  });
  return { ok: true, result: undefined };
}

/** Émet un avoir réduisant le solde dû de la facture. */
export async function issueCreditNote(
  actorUserId: string,
  input: { invoiceId: string; amount: number; reason: string },
): Promise<BillingResult<{ id: string; creditNoteNumber: string }>> {
  if (!Number.isInteger(input.amount) || input.amount <= 0 || !input.reason.trim()) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const inv = await prisma.platformInvoice.findUnique({
    where: { id: input.invoiceId },
    select: { id: true, schoolId: true, status: true, total: true },
  });
  if (!inv) return { ok: false, error: "NOT_FOUND" };
  if (inv.status === "CANCELLED") return { ok: false, error: "INVALID_STATUS" };

  const year = new Date().getUTCFullYear();
  try {
    let note: { id: string; creditNoteNumber: string } | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4 && !note; attempt++) {
      const count = await prisma.platformCreditNote.count({
        where: { creditNoteNumber: { startsWith: `AV-${year}-` } },
      });
      const num = `AV-${year}-${String(count + 1).padStart(5, "0")}`;
      try {
        note = await prisma.platformCreditNote.create({
          data: {
            creditNoteNumber: num,
            invoiceId: inv.id,
            schoolId: inv.schoolId,
            amount: input.amount,
            reason: input.reason.trim(),
            createdById: actorUserId,
          },
          select: { id: true, creditNoteNumber: true },
        });
      } catch (e) {
        lastError = e;
        if ((e as { code?: string })?.code !== "P2002") throw e;
      }
    }
    if (!note) throw lastError;
    await recomputeInvoiceStatus(inv.id);
    await logAudit({
      actorId: actorUserId,
      schoolId: inv.schoolId,
      action: "platform.credit_note.create",
      entity: "PlatformCreditNote",
      entityId: note.id,
      metadata: { invoiceId: inv.id, amount: input.amount },
    });
    return { ok: true, result: note };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function cancelInvoice(
  actorUserId: string,
  input: { invoiceId: string; reason: string },
): Promise<BillingResult> {
  if (!input.reason.trim()) return { ok: false, error: "INVALID_INPUT" };
  const inv = await prisma.platformInvoice.findUnique({
    where: { id: input.invoiceId },
    select: { id: true, schoolId: true, status: true },
  });
  if (!inv) return { ok: false, error: "NOT_FOUND" };
  if (inv.status === "CANCELLED") return { ok: false, error: "INVALID_STATUS" };
  await prisma.platformInvoice.update({
    where: { id: inv.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason.trim() },
  });
  await logAudit({
    actorId: actorUserId,
    schoolId: inv.schoolId,
    action: "platform.invoice.cancel",
    entity: "PlatformInvoice",
    entityId: inv.id,
    metadata: { reason: input.reason },
  });
  return { ok: true, result: undefined };
}

// ---------- Lecture ----------

export async function listInvoices(filters: {
  schoolId?: string;
  status?: PlatformInvoiceStatus;
} = {}) {
  return prisma.platformInvoice.findMany({
    where: {
      ...(filters.schoolId ? { schoolId: filters.schoolId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    include: {
      school: { select: { name: true, code: true } },
      payments: { where: { status: "VALIDATED" }, select: { amount: true } },
      creditNotes: { select: { amount: true } },
    },
    orderBy: { issueDate: "desc" },
    take: 200,
  });
}

export async function listSchoolInvoices(schoolId: string) {
  const invoices = await prisma.platformInvoice.findMany({
    where: { schoolId },
    include: {
      payments: { where: { status: "VALIDATED" }, select: { amount: true, paidAt: true, method: true, reference: true } },
      creditNotes: { select: { amount: true, creditNoteNumber: true, createdAt: true } },
    },
    orderBy: { issueDate: "desc" },
  });
  return invoices.map((i) => {
    const paid = i.payments.reduce((s, p) => s + p.amount, 0);
    const credited = i.creditNotes.reduce((s, c) => s + c.amount, 0);
    return { ...i, paid, credited, balance: Math.max(0, i.total - paid - credited) };
  });
}

/** Impayés SaaS : factures échues non soldées. */
export async function listUnpaidInvoices() {
  const today = new Date();
  const invoices = await prisma.platformInvoice.findMany({
    where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: today } },
    include: {
      school: { select: { name: true, code: true } },
      payments: { where: { status: "VALIDATED" }, select: { amount: true } },
      creditNotes: { select: { amount: true } },
    },
    orderBy: { dueDate: "asc" },
  });
  return invoices.map((i) => {
    const paid = i.payments.reduce((s, p) => s + p.amount, 0);
    const credited = i.creditNotes.reduce((s, c) => s + c.amount, 0);
    return {
      ...i,
      paid,
      credited,
      balance: Math.max(0, i.total - paid - credited),
      daysLate: Math.floor((today.getTime() - i.dueDate.getTime()) / 86400000),
    };
  }).filter((i) => i.balance > 0);
}
