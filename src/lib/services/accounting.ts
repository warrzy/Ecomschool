/**
 * H12 — Comptabilité et exports SYSCOHADA.
 *
 * Principes :
 * - Le plan comptable, les journaux et les correspondances métier→comptes
 *   sont propres à chaque établissement (aucun référentiel imposé ; un
 *   plan SYSCOHADA de démarrage est proposé et modifiable).
 * - Une écriture est TOUJOURS équilibrée (Σ débit = Σ crédit) à la
 *   création ; POSTED = immuable — une correction passe par contre-
 *   passation (écriture inverse), jamais par modification.
 * - Une seule écriture par événement source (paiement, annulation,
 *   remboursement, dépense) via l'unicité [schoolId, sourceType, sourceId]
 *   — aucun doublon comptable possible.
 * - La génération est idempotente et ne modifie JAMAIS les données
 *   financières sources (lecture seule sur Payment/Expense/Refund).
 * - Les écritures SIMULATION sont séparées des REAL et exclues des
 *   exports par défaut ; un paiement annulé produit une contre-
 *   passation, pas une suppression.
 */
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { Prisma } from "@prisma/client";

export type SchoolCtx = { userId: string; schoolId: string };
export type AcctResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: string };

function ok<T>(result: T): AcctResult<T> {
  return { ok: true, result };
}
function err(error: string): AcctResult<never> {
  return { ok: false, error };
}

async function hasPerm(ctx: SchoolCtx, key: string) {
  return userHasSchoolPermission({
    userId: ctx.userId, schoolId: ctx.schoolId, permissionKey: key,
  });
}

/** Plan SYSCOHADA de démarrage — codes usuels, ajustables par école. */
export const SYSCOHADA_STARTER = {
  accounts: [
    { code: "411", name: "Élèves — créances", classNumber: 4 },
    { code: "401", name: "Fournisseurs", classNumber: 4 },
    { code: "521", name: "Banques locales", classNumber: 5 },
    { code: "571", name: "Caisse siège", classNumber: 5 },
    { code: "585", name: "Virements de fonds (Mobile Money)", classNumber: 5 },
    { code: "605", name: "Autres achats", classNumber: 6 },
    { code: "62", name: "Services extérieurs", classNumber: 6 },
    { code: "66", name: "Charges de personnel", classNumber: 6 },
    { code: "701", name: "Ventes de marchandises", classNumber: 7 },
    { code: "706", name: "Prestations scolaires", classNumber: 7 },
  ] as const,
  journals: [
    { code: "CA", label: "Caisse", account: "571" },
    { code: "BQ", label: "Banque", account: "521" },
    { code: "MM", label: "Mobile Money", account: "585" },
    { code: "VE", label: "Ventes", account: null },
    { code: "OD", label: "Opérations diverses", account: null },
  ] as const,
  maps: [
    { key: "METHOD:CASH", account: "571", journal: "CA" },
    { key: "METHOD:BANK_TRANSFER", account: "521", journal: "BQ" },
    { key: "METHOD:CHECK", account: "521", journal: "BQ" },
    { key: "METHOD:MOBILE_MONEY", account: "585", journal: "MM" },
    { key: "METHOD:MOBILE_MONEY_MANUAL", account: "585", journal: "MM" },
    { key: "METHOD:OTHER", account: "571", journal: "CA" },
    { key: "FALLBACK:CAT", account: "706", journal: "VE" },
    { key: "FALLBACK:EXPCAT", account: "605", journal: "OD" },
    { key: "FALLBACK:RECEIVABLE", account: "411", journal: "OD" },
  ] as const,
};

// ---------- Référentiel ----------

/** Installe le plan de démarrage (idempotent — upserts par code). */
export async function installStarterPlan(ctx: SchoolCtx) {
  if (!(await hasPerm(ctx, "accounting.manage"))) return err("FORBIDDEN");
  const acc = new Map<string, string>();
  for (const a of SYSCOHADA_STARTER.accounts) {
    const r = await prisma.accountingAccount.upsert({
      where: { schoolId_code: { schoolId: ctx.schoolId, code: a.code } },
      create: { schoolId: ctx.schoolId, ...a },
      update: {},
    });
    acc.set(a.code, r.id);
  }
  const jour = new Map<string, string>();
  for (const j of SYSCOHADA_STARTER.journals) {
    const r = await prisma.accountingJournal.upsert({
      where: { schoolId_code: { schoolId: ctx.schoolId, code: j.code } },
      create: {
        schoolId: ctx.schoolId, code: j.code, label: j.label,
        defaultAccountId: j.account ? acc.get(j.account)! : null,
      },
      update: {},
    });
    jour.set(j.code, r.id);
  }
  for (const m of SYSCOHADA_STARTER.maps) {
    await prisma.accountingAccountMap.upsert({
      where: { schoolId_key: { schoolId: ctx.schoolId, key: m.key } },
      create: {
        schoolId: ctx.schoolId, key: m.key,
        accountId: acc.get(m.account)!,
        journalId: m.journal ? jour.get(m.journal)! : null,
      },
      update: {},
    });
  }
  await logAudit({
    actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "accounting.starter.install", entity: "AccountingAccount",
    metadata: { accounts: SYSCOHADA_STARTER.accounts.length },
  });
  return ok({ accounts: acc.size, journals: jour.size });
}

export async function listAccounts(ctx: SchoolCtx) {
  if (!(await hasPerm(ctx, "accounting.read"))) return err("FORBIDDEN");
  return ok(await prisma.accountingAccount.findMany({
    where: { schoolId: ctx.schoolId, status: "ACTIVE" },
    orderBy: { code: "asc" },
  }));
}

export async function upsertAccount(
  ctx: SchoolCtx,
  input: { id?: string; code: string; name: string; classNumber: number },
) {
  if (!(await hasPerm(ctx, "accounting.manage"))) return err("FORBIDDEN");
  if (!/^[0-9]{1,6}$/.test(input.code)) return err("INVALID_INPUT");
  const used = await prisma.accountingEntryLine.findFirst({
    where: { account: { schoolId: ctx.schoolId, code: input.code } },
    select: { id: true },
  });
  const r = await prisma.accountingAccount.upsert({
    where: { schoolId_code: { schoolId: ctx.schoolId, code: input.code } },
    create: {
      schoolId: ctx.schoolId, code: input.code,
      name: input.name, classNumber: input.classNumber,
    },
    update: used ? {} : { name: input.name, classNumber: input.classNumber },
  });
  await logAudit({
    actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "accounting.account.upsert", entity: "AccountingAccount",
    entityId: r.id, metadata: { code: input.code },
  });
  return ok(r);
}

export async function archiveAccount(ctx: SchoolCtx, accountId: string) {
  if (!(await hasPerm(ctx, "accounting.manage"))) return err("FORBIDDEN");
  const used = await prisma.accountingEntryLine.findFirst({
    where: { accountId }, select: { id: true },
  });
  if (used) return err("ACCOUNT_IN_USE");
  const r = await prisma.accountingAccount.updateMany({
    where: { id: accountId, schoolId: ctx.schoolId },
    data: { status: "ARCHIVED" },
  });
  if (r.count === 0) return err("NOT_FOUND");
  return ok({ archived: r.count });
}

export async function listJournals(ctx: SchoolCtx) {
  if (!(await hasPerm(ctx, "accounting.read"))) return err("FORBIDDEN");
  return ok(await prisma.accountingJournal.findMany({
    where: { schoolId: ctx.schoolId, status: "ACTIVE" },
    orderBy: { code: "asc" },
  }));
}

export async function upsertMapping(
  ctx: SchoolCtx,
  input: { key: string; accountId: string; journalId?: string | null },
) {
  if (!(await hasPerm(ctx, "accounting.manage"))) return err("FORBIDDEN");
  const acc = await prisma.accountingAccount.findFirst({
    where: { id: input.accountId, schoolId: ctx.schoolId },
  });
  if (!acc) return err("NOT_FOUND");
  const r = await prisma.accountingAccountMap.upsert({
    where: { schoolId_key: { schoolId: ctx.schoolId, key: input.key } },
    create: { schoolId: ctx.schoolId, ...input },
    update: { accountId: input.accountId, journalId: input.journalId ?? null },
  });
  await logAudit({
    actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "accounting.mapping.upsert", entity: "AccountingAccountMap",
    entityId: r.id, metadata: { key: input.key, account: acc.code },
  });
  return ok(r);
}

export async function listMappings(ctx: SchoolCtx) {
  if (!(await hasPerm(ctx, "accounting.read"))) return err("FORBIDDEN");
  return ok(await prisma.accountingAccountMap.findMany({
    where: { schoolId: ctx.schoolId },
    include: { account: { select: { code: true, name: true } } },
    orderBy: { key: "asc" },
  }));
}

// ---------- Exercices ----------

export async function listExercises(ctx: SchoolCtx) {
  if (!(await hasPerm(ctx, "accounting.read"))) return err("FORBIDDEN");
  return ok(await prisma.accountingExercise.findMany({
    where: { schoolId: ctx.schoolId },
    orderBy: { startDate: "desc" },
  }));
}

export async function openExercise(
  ctx: SchoolCtx,
  input: { name: string; startDate: Date; endDate: Date },
) {
  if (!(await hasPerm(ctx, "accounting.manage"))) return err("FORBIDDEN");
  if (input.endDate <= input.startDate) return err("INVALID_INPUT");
  const overlap = await prisma.accountingExercise.findFirst({
    where: {
      schoolId: ctx.schoolId, status: "OPEN",
      startDate: { lte: input.endDate }, endDate: { gte: input.startDate },
    },
  });
  if (overlap) return err("EXERCISE_OVERLAP");
  const r = await prisma.accountingExercise.create({
    data: { schoolId: ctx.schoolId, ...input },
  });
  await logAudit({
    actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "accounting.exercise.open", entity: "AccountingExercise",
    entityId: r.id,
  });
  return ok(r);
}

/** Clôture irréversible d'un exercice — bloque toute nouvelle écriture. */
export async function closeExercise(ctx: SchoolCtx, exerciseId: string) {
  if (!(await hasPerm(ctx, "accounting.manage"))) return err("FORBIDDEN");
  const r = await prisma.accountingExercise.updateMany({
    where: { id: exerciseId, schoolId: ctx.schoolId, status: "OPEN" },
    data: { status: "CLOSED" },
  });
  if (r.count === 0) return err("NOT_FOUND_OR_CLOSED");
  await logAudit({
    actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "accounting.exercise.close", entity: "AccountingExercise",
    entityId: exerciseId,
  });
  return ok({ closed: true });
}

// ---------- Génération des écritures ----------

export type Line = { accountId: string; debit?: number; credit?: number; label?: string };

function nextEntryRef(seq: number, year: number) {
  return `EC-${year}-${String(seq).padStart(5, "0")}`;
}

async function createEntry(
  ctx: SchoolCtx,
  tx: Prisma.TransactionClient,
  input: {
    journalId: string; exerciseId: string; date: Date;
    description: string; sourceType?: string; sourceId?: string;
    origin?: "REAL" | "SIMULATION"; incomplete?: boolean; lines: Line[];
  },
): Promise<{ id: string; status: string }> {
  const d = input.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
  const c = input.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
  if (d !== c || d === 0) throw new Error(`UNBALANCED:${d}/${c}`);
  const exercise = await tx.accountingExercise.findUniqueOrThrow({
    where: { id: input.exerciseId },
    select: { status: true, startDate: true, endDate: true },
  });
  if (exercise.status !== "OPEN") throw new Error("EXERCISE_CLOSED");
  if (input.date < exercise.startDate || input.date > exercise.endDate)
    throw new Error("EXERCISE_RANGE");
  const year = input.date.getFullYear();
  // Séquence de référence sous verrou transactionnel (aucun doublon).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"ECREF" + ctx.schoolId + year}))`;
  const seq = await tx.accountingEntry.count({
    where: { schoolId: ctx.schoolId, reference: { startsWith: `EC-${year}-` } },
  });
  const entry = await tx.accountingEntry.create({
    data: {
      schoolId: ctx.schoolId,
      journalId: input.journalId,
      exerciseId: input.exerciseId,
      date: input.date,
      reference: nextEntryRef(seq + 1, year),
      description: input.description,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      status: input.incomplete ? "INCOMPLETE" : "POSTED",
      origin: input.origin ?? "REAL",
      postedById: ctx.userId,
      postedAt: new Date(),
      lines: {
        create: input.lines.map((l, i) => ({
          accountId: l.accountId, debit: l.debit ?? 0,
          credit: l.credit ?? 0, label: l.label ?? null, sortOrder: i,
        })),
      },
    },
    select: { id: true, status: true },
  });
  return entry;
}

/** Poste une écriture en transaction ; ignore le doublon concurrent (P2002). */
export async function postEntrySafe(
  ctx: SchoolCtx,
  input: Parameters<typeof createEntry>[2],
): Promise<boolean> {
  try {
    await prisma.$transaction((tx) => createEntry(ctx, tx, input));
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return false;
    throw e;
  }
}

export async function mapsByKey(ctx: SchoolCtx) {
  const rows = await prisma.accountingAccountMap.findMany({
    where: { schoolId: ctx.schoolId },
    select: { key: true, accountId: true, journalId: true },
  });
  return new Map(rows.map((m) => [m.key, m]));
}

export function exerciseFor(
  exercises: { id: string; startDate: Date; endDate: Date; mode?: string }[],
  date: Date,
) {
  return exercises.find((e) => date >= e.startDate && date <= e.endDate);
}

type GenStats = {
  payments: number; cancels: number; refunds: number;
  expenses: number; incomplete: number; skipped: number;
};

/**
 * Génère les écritures des opérations réelles non encore comptabilisées.
 * Idempotent — l'unicité source empêche tout doublon ; les opérations
 * dont le compte de trésorerie n'est pas mappé sont signalées dans les
 * statistiques (aucune écriture inventée silencieusement).
 */
/** Exercices ouverts de l'école (avec mode caisse/engagement). */
export async function openExercises(schoolId: string) {
  return prisma.accountingExercise.findMany({
    where: { schoolId, status: "OPEN" },
    select: { id: true, startDate: true, endDate: true, mode: true },
  });
}

export async function generateEntries(ctx: SchoolCtx): Promise<AcctResult<GenStats>> {
  if (!(await hasPerm(ctx, "accounting.manage"))) return err("FORBIDDEN");
  const stats: GenStats = { payments: 0, cancels: 0, refunds: 0, expenses: 0, incomplete: 0, skipped: 0 };
  const exercises = await openExercises(ctx.schoolId);
  if (exercises.length === 0) return err("NO_OPEN_EXERCISE");
  const maps = await mapsByKey(ctx);
  const posted = new Set(
    (await prisma.accountingEntry.findMany({
      where: { schoolId: ctx.schoolId, sourceId: { not: null } },
      select: { sourceType: true, sourceId: true },
    })).map((e) => `${e.sourceType}:${e.sourceId}`),
  );
  const journalList = await prisma.accountingJournal.findMany({
    where: { schoolId: ctx.schoolId, status: "ACTIVE" },
  });
  const odd = journalList.find((j) => j.code === "OD") ?? journalList[0];
  if (!odd) return err("NO_JOURNAL");

  // --- Paiements validés ---
  const payments = await prisma.payment.findMany({
    where: { schoolId: ctx.schoolId, status: "VALIDATED" },
    include: {
      allocations: {
        include: {
          installment: { include: { charge: { select: { categoryId: true } } } },
        },
      },
    },
    orderBy: { paidAt: "asc" },
  });
  for (const p of payments) {
    if (posted.has(`PAYMENT:${p.id}`)) continue;
    const ex = exerciseFor(exercises, p.paidAt);
    if (!ex) { stats.skipped++; continue; }
    const mid = maps.get(`METHOD:${p.method}`);
    const credits = new Map<string, number>();
    if (ex.mode === "ACCRUAL") {
      // Engagement : le règlement solde la créance 411, le produit est né à la facturation.
      const receivable = maps.get("FALLBACK:RECEIVABLE")?.accountId;
      if (receivable) credits.set(receivable, p.amount);
    } else {
      for (const a of p.allocations) {
        const accId = maps.get(`CAT:${a.installment.charge.categoryId}`)?.accountId
          ?? maps.get("FALLBACK:CAT")?.accountId;
        if (accId) credits.set(accId, (credits.get(accId) ?? 0) + a.amount);
      }
    }
    if (!mid || credits.size === 0) { stats.incomplete++; continue; }
    const lines: Line[] = [
      { accountId: mid.accountId, debit: p.amount, label: `Encaissement ${p.receiptNumber ?? ""}`.trim() },
      ...Array.from(credits).map(([accId, amt]) => ({ accountId: accId, credit: amt })),
    ];
    if (await postEntrySafe(ctx, {
      journalId: mid.journalId ?? odd.id, exerciseId: ex.id,
      date: p.paidAt,
      description: `Encaissement ${p.receiptNumber ?? p.id} — ${p.method}`,
      sourceType: "PAYMENT", sourceId: p.id, lines,
    })) stats.payments++;
    else stats.skipped++;
  }

  // --- Paiements annulés → contre-passation ---
  const cancelled = await prisma.payment.findMany({
    where: { schoolId: ctx.schoolId, status: "CANCELLED" },
    select: { id: true, cancelledAt: true, receiptNumber: true },
  });
  for (const p of cancelled) {
    if (posted.has(`PAYMENT_CANCEL:${p.id}`)) continue;
    const orig = await prisma.accountingEntry.findFirst({
      where: { schoolId: ctx.schoolId, sourceType: "PAYMENT", sourceId: p.id },
      include: { lines: true },
    });
    const ex = exerciseFor(exercises, p.cancelledAt ?? new Date());
    if (!orig || !ex) { stats.skipped++; continue; }
    if (await postEntrySafe(ctx, {
      journalId: orig.journalId, exerciseId: ex.id,
      date: p.cancelledAt ?? new Date(),
      description: `Contre-passation annulation ${p.receiptNumber ?? p.id}`,
      sourceType: "PAYMENT_CANCEL", sourceId: p.id,
      lines: orig.lines.map((l) => ({
        accountId: l.accountId, debit: l.credit, credit: l.debit,
        label: `Contre-passation ${l.label ?? ""}`.trim(),
      })),
    })) stats.cancels++;
    else stats.skipped++;
  }

  // --- Remboursements confirmés → reprise du produit ---
  const refunds = await prisma.paymentRefund.findMany({
    where: { schoolId: ctx.schoolId, status: "CONFIRMED", paymentId: { not: null } },
    include: { payment: { select: { method: true, id: true, receiptNumber: true } } },
  });
  for (const r of refunds) {
    if (posted.has(`REFUND:${r.id}`)) continue;
    const orig = await prisma.accountingEntry.findFirst({
      where: { schoolId: ctx.schoolId, sourceType: "PAYMENT", sourceId: r.paymentId! },
      include: { lines: true },
    });
    const ex = exerciseFor(exercises, r.confirmedAt ?? new Date());
    const mid = maps.get(`METHOD:${r.payment!.method}`);
    const revenueAcc = orig?.lines.find((l) => l.credit > 0)?.accountId;
    if (!orig || !ex || !mid || !revenueAcc) { stats.skipped++; continue; }
    if (await postEntrySafe(ctx, {
      journalId: orig.journalId, exerciseId: ex.id,
      date: r.confirmedAt ?? new Date(),
      description: `Remboursement ${r.payment!.receiptNumber ?? r.id} — ${r.reason}`,
      sourceType: "REFUND", sourceId: r.id,
      lines: [
        { accountId: revenueAcc, debit: r.amount, label: "Reversement" },
        { accountId: mid.accountId, credit: r.amount },
      ],
    })) stats.refunds++;
    else stats.skipped++;
  }

  // --- Dépenses payées ---
  const expenses = await prisma.expense.findMany({
    where: { schoolId: ctx.schoolId, status: "PAID" },
    orderBy: { paidAt: "asc" },
  });
  for (const e of expenses) {
    if (posted.has(`EXPENSE:${e.id}`)) continue;
    const ex = exerciseFor(exercises, e.paidAt ?? e.expenseAt);
    if (!ex) { stats.skipped++; continue; }
    const cat = maps.get(`EXPCAT:${e.categoryId}`) ?? maps.get("FALLBACK:EXPCAT");
    const mid = maps.get(`METHOD:${e.method ?? "CASH"}`) ?? maps.get("METHOD:CASH");
    if (!cat || !mid) { stats.incomplete++; continue; }
    if (await postEntrySafe(ctx, {
      journalId: mid.journalId ?? odd.id, exerciseId: ex.id,
      date: e.paidAt ?? e.expenseAt,
      description: `Dépense ${e.label} — ${e.beneficiary}`,
      sourceType: "EXPENSE", sourceId: e.id,
      lines: [
        { accountId: cat.accountId, debit: e.amount, label: e.label },
        { accountId: mid.accountId, credit: e.amount },
      ],
    })) stats.expenses++;
    else stats.skipped++;
  }

  await logAudit({
    actorId: ctx.userId, schoolId: ctx.schoolId,
    action: "accounting.entries.generate", entity: "AccountingEntry",
    metadata: { ...stats },
  });
  return ok(stats);
}

/** Opérations réelles sans écriture (compte non mappé ou hors exercice). */
export async function listUnposted(ctx: SchoolCtx) {
  if (!(await hasPerm(ctx, "accounting.read"))) return err("FORBIDDEN");
  const posted = new Set(
    (await prisma.accountingEntry.findMany({
      where: { schoolId: ctx.schoolId, sourceId: { not: null } },
      select: { sourceType: true, sourceId: true },
    })).map((e) => `${e.sourceType}:${e.sourceId}`),
  );
  const payIds = new Set(
    (await prisma.payment.findMany({
      where: { schoolId: ctx.schoolId, status: "VALIDATED" }, select: { id: true },
    })).map((p) => `PAYMENT:${p.id}`),
  );
  const expIds = new Set(
    (await prisma.expense.findMany({
      where: { schoolId: ctx.schoolId, status: "PAID" }, select: { id: true },
    })).map((e) => `EXPENSE:${e.id}`),
  );
  const refIds = new Set(
    (await prisma.paymentRefund.findMany({
      where: { schoolId: ctx.schoolId, status: "CONFIRMED", paymentId: { not: null } },
      select: { id: true },
    })).map((r) => `REFUND:${r.id}`),
  );
  const unposted = (s: Set<string>) => Array.from(s).filter((k) => !posted.has(k)).length;
  return ok({
    payments: unposted(payIds),
    expenses: unposted(expIds),
    refunds: unposted(refIds),
    postedCount: posted.size,
  });
}

/** Écriture manuelle — SIMULATION possible ; toujours équilibrée. */
export async function createManualEntry(
  ctx: SchoolCtx,
  input: {
    journalId: string; exerciseId: string; date: Date;
    description: string; origin?: "REAL" | "SIMULATION";
    lines: { accountId: string; debit?: number; credit?: number; label?: string }[];
  },
): Promise<AcctResult<{ id: string }>> {
  if (!(await hasPerm(ctx, "accounting.manage"))) return err("FORBIDDEN");
  const jour = await prisma.accountingJournal.findFirst({
    where: { id: input.journalId, schoolId: ctx.schoolId },
  });
  const ex = await prisma.accountingExercise.findFirst({
    where: { id: input.exerciseId, schoolId: ctx.schoolId },
  });
  if (!jour || !ex) return err("NOT_FOUND");
  const accs = await prisma.accountingAccount.findMany({
    where: { schoolId: ctx.schoolId, id: { in: input.lines.map((l) => l.accountId) } },
    select: { id: true },
  });
  if (accs.length !== input.lines.length) return err("NOT_FOUND");
  try {
    const r = await prisma.$transaction((tx) =>
      createEntry(ctx, tx, { ...input }));
    await logAudit({
      actorId: ctx.userId, schoolId: ctx.schoolId,
      action: "accounting.entry.create", entity: "AccountingEntry",
      entityId: r.id, metadata: { origin: input.origin ?? "REAL" },
    });
    return ok(r);
  } catch (e) {
    return err(e instanceof Error && e.message.startsWith("UNBALANCED")
      ? "UNBALANCED" : "INVALID_STATE");
  }
}

// ---------- Consultation & exports ----------

export async function listEntries(
  ctx: SchoolCtx,
  filter?: { exerciseId?: string; journalId?: string; status?: string; origin?: string },
) {
  if (!(await hasPerm(ctx, "accounting.read"))) return err("FORBIDDEN");
  return ok(await prisma.accountingEntry.findMany({
    where: {
      schoolId: ctx.schoolId,
      exerciseId: filter?.exerciseId,
      journalId: filter?.journalId,
      status: filter?.status as never,
      origin: filter?.origin as never,
    },
    include: {
      journal: { select: { code: true } },
      lines: {
        include: { account: { select: { code: true, name: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ date: "asc" }, { reference: "asc" }],
  }));
}

/** Balance générale : totalis débit/crédit par compte (POSTED, REAL par défaut). */
export async function trialBalance(
  ctx: SchoolCtx, exerciseId: string, includeSimulation = false,
) {
  if (!(await hasPerm(ctx, "accounting.read"))) return err("FORBIDDEN");
  const lines = await prisma.accountingEntryLine.findMany({
    where: {
      entry: {
        schoolId: ctx.schoolId, exerciseId, status: "POSTED",
        ...(includeSimulation ? {} : { origin: "REAL" as const }),
      },
    },
    include: { account: { select: { code: true, name: true, classNumber: true } } },
  });
  const rows = new Map<string, { code: string; name: string; classNumber: number; debit: number; credit: number }>();
  for (const l of lines) {
    const r = rows.get(l.accountId) ?? {
      code: l.account.code, name: l.account.name,
      classNumber: l.account.classNumber, debit: 0, credit: 0,
    };
    r.debit += l.debit;
    r.credit += l.credit;
    rows.set(l.accountId, r);
  }
  const balance = Array.from(rows.values()).sort((a, b) => a.code.localeCompare(b.code));
  return ok({
    balance,
    totalDebit: balance.reduce((s, r) => s + r.debit, 0),
    totalCredit: balance.reduce((s, r) => s + r.credit, 0),
  });
}

/** Grand livre : mouvements par compte sur l'exercice. */
export async function generalLedger(
  ctx: SchoolCtx, exerciseId: string, accountId: string, includeSimulation = false,
) {
  if (!(await hasPerm(ctx, "accounting.read"))) return err("FORBIDDEN");
  const acc = await prisma.accountingAccount.findFirst({
    where: { id: accountId, schoolId: ctx.schoolId },
  });
  if (!acc) return err("NOT_FOUND");
  const lines = await prisma.accountingEntryLine.findMany({
    where: {
      accountId,
      entry: {
        schoolId: ctx.schoolId, exerciseId, status: "POSTED",
        ...(includeSimulation ? {} : { origin: "REAL" as const }),
      },
    },
    include: {
      entry: { select: { reference: true, date: true, description: true, journal: { select: { code: true } } } },
    },
    orderBy: { entry: { date: "asc" } },
  });
  return ok({ account: acc, lines });
}

/** Export CSV — lecture seule, jamais d'écriture sur les sources. */
export async function exportCsv(
  ctx: SchoolCtx,
  kind: "journal" | "ledger" | "balance",
  exerciseId: string,
  opts?: { journalId?: string; accountId?: string; includeSimulation?: boolean },
): Promise<AcctResult<{ csv: string; filename: string }>> {
  if (!(await hasPerm(ctx, "accounting.export"))) return err("FORBIDDEN");
  // Protection injection de formules : une cellule commençant par
  // = + - @ ou caractères de contrôle est préfixée d'une apostrophe.
  const esc = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  const rows: string[] = [];
  if (kind === "journal") {
    const entries = await listEntries(ctx, {
      exerciseId, journalId: opts?.journalId,
      origin: opts?.includeSimulation ? undefined : "REAL",
    });
    if (!entries.ok) return err(entries.error);
    rows.push("reference;date;journal;compte;libelle;debit;credit");
    for (const e of entries.result)
      for (const l of e.lines)
        rows.push([
          e.reference, e.date.toISOString().slice(0, 10), e.journal.code,
          l.account.code, l.label ?? e.description, l.debit || "", l.credit || "",
        ].map(esc).join(";"));
    await logAudit({
      actorId: ctx.userId, schoolId: ctx.schoolId,
      action: "accounting.export", entity: "AccountingEntry",
      metadata: { kind, exerciseId },
    });
    return ok({ csv: rows.join("\r\n"), filename: `journal-${exerciseId}.csv` });
  }
  if (kind === "ledger") {
    if (!opts?.accountId) return err("INVALID_INPUT");
    const gl = await generalLedger(ctx, exerciseId, opts.accountId, opts.includeSimulation);
    if (!gl.ok) return err(gl.error);
    rows.push("reference;date;journal;description;debit;credit;solde");
    let bal = 0;
    for (const l of gl.result.lines) {
      bal += l.debit - l.credit;
      rows.push([l.entry.reference, l.entry.date.toISOString().slice(0, 10),
        l.entry.journal.code, l.entry.description, l.debit || "", l.credit || "", bal,
      ].map(esc).join(";"));
    }
    return ok({ csv: rows.join("\r\n"), filename: `grand-livre-${gl.result.account.code}.csv` });
  }
  const tb = await trialBalance(ctx, exerciseId, opts?.includeSimulation);
  if (!tb.ok) return err(tb.error);
  rows.push("compte;intitule;classe;total_debit;total_credit;solde");
  for (const r of tb.result.balance)
    rows.push([r.code, r.name, r.classNumber, r.debit, r.credit, r.debit - r.credit].map(esc).join(";"));
  return ok({ csv: rows.join("\r\n"), filename: `balance-${exerciseId}.csv` });
}
