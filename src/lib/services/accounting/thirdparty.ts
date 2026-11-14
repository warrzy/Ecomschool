/**
 * CG-2 — Référentiel tiers auxiliaires + balance âgée des créances.
 * Soldes : Σ débits auxiliaires − Σ allocations (lettrage CG-1).
 * Vieillissement (élèves) : échéancier FeeInstallment − règlements,
 * buckets non-échu / 1-30 / 31-60 / 61-90 / +90 j (sur dueDate).
 */
import { prisma } from "@/lib/db/prisma";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";

type Ctx = { userId: string; schoolId: string };
type Res<T> = { ok: true; result: T } | { ok: false; error: string };
const ok = <T>(r: T): Res<T> => ({ ok: true, result: r });
const err = (e: string): Res<never> => ({ ok: false, error: e });
const has = (ctx: Ctx, k: string) => userHasSchoolPermission({ userId: ctx.userId, schoolId: ctx.schoolId, permissionKey: k });

/** Liste les tiers avec solde auxiliaire. */
export async function listThirdParties(ctx: Ctx, filter?: { kind?: string; q?: string }) {
  if (!(await has(ctx, "accounting.read"))) return err("FORBIDDEN");
  const tps = await prisma.accountingThirdParty.findMany({
    where: {
      schoolId: ctx.schoolId,
      kind: filter?.kind as never,
      OR: filter?.q ? [
        { name: { contains: filter.q, mode: "insensitive" } },
        { refId: { contains: filter.q } },
      ] : undefined,
    },
    include: { collectiveAccount: { select: { code: true } } },
    orderBy: { name: "asc" },
  });
  const [debits, allocs] = await Promise.all([
    prisma.accountingEntryLine.groupBy({
      by: ["thirdPartyId"], where: { entry: { schoolId: ctx.schoolId }, debit: { gt: 0 } },
      _sum: { debit: true },
    }),
    prisma.accountingAllocation.groupBy({
      by: ["thirdPartyId"], where: { schoolId: ctx.schoolId },
      _sum: { amount: true },
    }),
  ]);
  const d = new Map(debits.map((x) => [x.thirdPartyId, x._sum.debit ?? 0]));
  const a = new Map(allocs.map((x) => [x.thirdPartyId, x._sum.amount ?? 0]));
  return ok(tps.map((t) => ({
    ...t,
    balance: (d.get(t.id) ?? 0) - (a.get(t.id) ?? 0),
  })));
}

/** Crée/modifie un tiers (fournisseur, partenaire…). Les élèves sont auto-provisionnés. */
export async function upsertThirdParty(ctx: Ctx, input: {
  id?: string; kind: "SUPPLIER" | "STAFF" | "OTHER"; name: string;
  refId?: string; collectiveAccountId: string;
}) {
  if (!(await has(ctx, "accounting.manage"))) return err("FORBIDDEN");
  if (!input.name.trim() || !input.collectiveAccountId) return err("INVALID_INPUT");
  const data = {
    schoolId: ctx.schoolId, kind: input.kind, name: input.name.trim(),
    refId: input.refId ?? null, collectiveAccountId: input.collectiveAccountId,
  };
  const r = input.id
    ? await prisma.accountingThirdParty.updateMany({
        where: { id: input.id, schoolId: ctx.schoolId }, data: { name: data.name, collectiveAccountId: data.collectiveAccountId },
      })
    : data.refId
      ? await prisma.accountingThirdParty.upsert({
          where: { schoolId_kind_refId: { schoolId: ctx.schoolId, kind: data.kind, refId: data.refId } },
          create: data, update: { name: data.name, collectiveAccountId: data.collectiveAccountId },
        })
      : await prisma.accountingThirdParty.create({ data });
  return ok({ saved: true, count: "count" in r ? r.count : 1 });
}

export type AgingBucket = { current: number; d1_30: number; d31_60: number; d61_90: number; d90p: number };

export type AgingRow = { studentId: string; tiers: string | null } & AgingBucket;

/** Balance âgée des créances élèves (échéancier − règlements reçus). */
export async function studentAging(ctx: Ctx): Promise<Res<AgingRow[]>> {
  if (!(await has(ctx, "accounting.read"))) return err("FORBIDDEN");
  const insts = await prisma.feeInstallment.findMany({
    where: { schoolId: ctx.schoolId },
    include: {
      allocations: { select: { amount: true } },
      charge: { select: { studentId: true } },
    },
  });
  const tps = await prisma.accountingThirdParty.findMany({
    where: { schoolId: ctx.schoolId, kind: "STUDENT" }, select: { id: true, refId: true, name: true },
  });
  const tpByStudent = new Map(tps.map((t) => [t.refId, t.name]));
  const now = Date.now();
  const byStudent = new Map<string, AgingBucket>();
  for (const i of insts) {
    const paid = i.allocations.reduce((s, a) => s + a.amount, 0);
    const due = i.amount - paid;
    if (due <= 0) continue;
    const days = Math.floor((now - i.dueDate.getTime()) / 86400000);
    const b = byStudent.get(i.charge.studentId) ?? { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
    if (days <= 0) b.current += due;
    else if (days <= 30) b.d1_30 += due;
    else if (days <= 60) b.d31_60 += due;
    else if (days <= 90) b.d61_90 += due;
    else b.d90p += due;
    byStudent.set(i.charge.studentId, b);
  }
  return ok(Array.from(byStudent).map(([studentId, b]) => ({
    studentId, tiers: tpByStudent.get(studentId) ?? null, ...b,
  })));
}

/** Export CSV balance âgée. */
export async function agingCsv(ctx: Ctx) {
  if (!(await has(ctx, "accounting.export"))) return err("FORBIDDEN");
  const r = await studentAging(ctx);
  if (!r.ok) return err(r.error);
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = ["eleve_id;tiers;non_echu;1_30;31_60;61_90;90_plus;total"];
  for (const x of r.result) {
    const t = x.current + x.d1_30 + x.d31_60 + x.d61_90 + x.d90p;
    rows.push([x.studentId, x.tiers ?? "", x.current, x.d1_30, x.d31_60, x.d61_90, x.d90p, t].map(esc).join(";"));
  }
  return ok(rows.join("\n"));
}
