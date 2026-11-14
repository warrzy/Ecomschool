/**
 * RH-3 — Moteur de paie configurable et versionné.
 * Grammaire de formule DÉTERMINISTE (aucune exécution de code) :
 *   {type:"fixed", amount}
 *   {type:"percent", rate, base}           base = base_salary | gross | <code composant antérieur>
 *   {type:"rate_x_qty", rate, qty}         qty = number | days_worked
 *   {type:"table", base, brackets:[{upTo,rate}]}  progressif par tranches
 * Pipeline ordonné par `order` ; formulaSnapshot figé dans chaque bulletin.
 * AUCUN paramètre réglementaire (CNSS/fiscal BF) n'est fourni ni activé :
 * isRegulatory=true ⇒ composant ignoré du calcul jusqu'à validation officielle.
 */
import { prisma } from "@/lib/db/prisma";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { logAudit } from "@/lib/services/audit";
import { Prisma } from "@prisma/client";

type Ctx = { userId: string; schoolId: string };
type Res<T> = { ok: true; result: T } | { ok: false; error: string };
const ok = <T>(r: T): Res<T> => ({ ok: true, result: r });
const err = (e: string): Res<never> => ({ ok: false, error: e });
const has = (ctx: Ctx, k: string) => userHasSchoolPermission({ ...ctx, permissionKey: k });

type Formula =
  | { type: "fixed"; amount: number }
  | { type: "percent"; rate: number; base: string }
  | { type: "rate_x_qty"; rate: number; qty: number }
  | { type: "table"; base: string; brackets: { upTo: number; rate: number }[] };

function validateFormula(f: unknown): f is Formula {
  if (typeof f !== "object" || f === null) return false;
  const x = f as Record<string, unknown>;
  if (x.type === "fixed") return typeof x.amount === "number" && x.amount >= 0;
  if (x.type === "percent") return typeof x.rate === "number" && x.rate >= 0 && x.rate <= 1 && typeof x.base === "string";
  if (x.type === "rate_x_qty") return typeof x.rate === "number" && x.rate >= 0 && typeof x.qty === "number" && x.qty >= 0;
  if (x.type === "table") return typeof x.base === "string" && Array.isArray(x.brackets)
    && (x.brackets as unknown[]).every((b) => typeof (b as { upTo?: unknown }).upTo === "number" && typeof (b as { rate?: unknown }).rate === "number");
  return false;
}

/** Évalue une formule dans le contexte des bases nommées — pur, sans effet de bord. */
export function evalFormula(f: Formula, bases: Map<string, number>): number {
  const base = (name: string) => bases.get(name) ?? 0;
  if (f.type === "fixed") return f.amount;
  if (f.type === "percent") return Math.round(base(f.base) * f.rate);
  if (f.type === "rate_x_qty") return Math.round(f.rate * f.qty);
  // Progressif : chaque tranche s'applique à la part du revenu dans la tranche.
  let remaining = base(f.base), prev = 0, tax = 0;
  for (const b of [...f.brackets].sort((a, b2) => a.upTo - b2.upTo)) {
    const span = Math.min(Math.max(remaining, 0), b.upTo - prev);
    tax += Math.round(span * b.rate);
    remaining -= span; prev = b.upTo;
    if (remaining <= 0) break;
  }
  return tax;
}

// ---------- Référentiel composants ----------

export async function listComponents(ctx: Ctx) {
  if (!(await has(ctx, "payroll.read"))) return err("FORBIDDEN");
  return ok(await prisma.salaryComponent.findMany({
    where: { schoolId: ctx.schoolId }, orderBy: [{ order: "asc" }, { code: "asc" }],
  }));
}

export async function upsertComponent(ctx: Ctx, input: {
  id?: string; code: string; label: string; kind: "EARNING" | "DEDUCTION" | "EMPLOYER_CHARGE";
  formula: unknown; order?: number; activeFrom: Date; activeTo?: Date;
  isRegulatory?: boolean; enabled?: boolean;
}) {
  if (!(await has(ctx, "payroll.manage"))) return err("FORBIDDEN");
  if (!input.code.trim() || !input.label.trim() || !validateFormula(input.formula)) return err("INVALID_FORMULA");
  if (input.id) {
    // Modification = nouvelle version : l'ancienne est désactivée, jamais mutée.
    const prev = await prisma.salaryComponent.findFirst({ where: { id: input.id, schoolId: ctx.schoolId } });
    if (!prev) return err("NOT_FOUND");
    await prisma.salaryComponent.update({ where: { id: prev.id }, data: { enabled: false } });
  }
  const last = await prisma.salaryComponent.findFirst({
    where: { schoolId: ctx.schoolId, code: input.code }, orderBy: { version: "desc" },
  });
  const c = await prisma.salaryComponent.create({
    data: {
      schoolId: ctx.schoolId, code: input.code, label: input.label, kind: input.kind,
      formula: input.formula as Prisma.InputJsonValue, order: input.order ?? 0,
      activeFrom: input.activeFrom, activeTo: input.activeTo ?? null,
      isRegulatory: input.isRegulatory ?? false, enabled: input.enabled ?? true,
      version: (last?.version ?? 0) + 1,
    },
  });
  return ok({ id: c.id, version: c.version });
}

// ---------- Runs ----------

export async function listRuns(ctx: Ctx) {
  if (!(await has(ctx, "payroll.read"))) return err("FORBIDDEN");
  return ok(await prisma.payrollRun.findMany({
    where: { schoolId: ctx.schoolId },
    include: { _count: { select: { payslips: true } } },
    orderBy: { periodStart: "desc" },
  }));
}

/** Calcule les bulletins du run (DRAFT). Rejeu = recalcul tant que DRAFT. */
export async function computeRun(ctx: Ctx, runId: string): Promise<Res<{ payslips: number }>> {
  if (!(await has(ctx, "payroll.manage"))) return err("FORBIDDEN");
  const run = await prisma.payrollRun.findFirst({
    where: { id: runId, schoolId: ctx.schoolId, status: "DRAFT" },
  });
  if (!run) return err("NOT_FOUND_OR_LOCKED");
  const components = (await prisma.salaryComponent.findMany({
    where: {
      schoolId: ctx.schoolId, enabled: true, isRegulatory: false,
      activeFrom: { lte: run.periodEnd },
      OR: [{ activeTo: null }, { activeTo: { gte: run.periodStart } }],
    },
    orderBy: { order: "asc" },
  })).filter((c) => validateFormula(c.formula));
  const employees = await prisma.employee.findMany({
    where: {
      schoolId: ctx.schoolId, status: "ACTIVE",
      OR: [{ hireDate: null }, { hireDate: { lte: run.periodEnd } }],
      AND: {
        OR: [{ departureDate: null }, { departureDate: { gte: run.periodStart } }],
      },
    },
    include: {
      contracts: {
        where: { status: "ACTIVE", startDate: { lte: run.periodEnd }, OR: [{ endDate: null }, { endDate: { gte: run.periodStart } }] },
        orderBy: { startDate: "desc" }, take: 1,
      },
    },
  });
  const snapshot = components.map((c) => ({ code: c.code, version: c.version, formula: c.formula }));
  await prisma.$transaction(async (tx) => {
    await tx.payslip.deleteMany({ where: { runId: run.id } });
    for (const e of employees) {
      const contract = e.contracts[0];
      if (!contract) continue; // pas de contrat actif sur la période → signalé par absence de bulletin
      const bases = new Map<string, number>([["base_salary", contract.baseSalary]]);
      const lines: { code: string; label: string; kind: string; amount: number; formula: unknown }[] = [];
      let gross = contract.baseSalary, deductions = 0, employerCost = 0;
      bases.set("gross", gross);
      for (const c of components) {
        const amount = evalFormula(c.formula as unknown as Formula, bases);
        lines.push({ code: c.code, label: c.label, kind: c.kind, amount, formula: c.formula });
        bases.set(c.code, amount);
        if (c.kind === "EARNING") { gross += amount; bases.set("gross", gross); }
        if (c.kind === "DEDUCTION") deductions += amount;
        if (c.kind === "EMPLOYER_CHARGE") employerCost += amount;
      }
      const net = gross - deductions;
      await tx.payslip.create({
        data: {
          runId: run.id, employeeId: e.id, contractId: contract.id,
          baseSalary: contract.baseSalary, gross, deductions, employerCost, net,
          lines: lines as unknown as Prisma.InputJsonValue,
          formulaSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      });
    }
  });
  const n = await prisma.payslip.count({ where: { runId: run.id } });
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "payroll.run.compute", entity: "PayrollRun", entityId: runId, metadata: { payslips: n } });
  return ok({ payslips: n });
}

export async function createRun(ctx: Ctx, input: { periodStart: Date; periodEnd: Date }): Promise<Res<{ id: string }>> {
  if (!(await has(ctx, "payroll.manage"))) return err("FORBIDDEN");
  if (input.periodEnd < input.periodStart) return err("INVALID_INPUT");
  const overlap = await prisma.payrollRun.findFirst({
    where: {
      schoolId: ctx.schoolId, status: { in: ["DRAFT", "VALIDATED", "POSTED"] },
      periodStart: { lte: input.periodEnd }, periodEnd: { gte: input.periodStart },
    },
  });
  if (overlap) return err("RUN_OVERLAP");
  const r = await prisma.payrollRun.create({ data: { schoolId: ctx.schoolId, ...input } });
  return ok({ id: r.id });
}

/** Validation : fige les bulletins — plus aucun recalcul possible. */
export async function validateRun(ctx: Ctx, runId: string) {
  if (!(await has(ctx, "payroll.manage"))) return err("FORBIDDEN");
  const n = await prisma.payslip.count({ where: { runId } });
  if (n === 0) return err("NO_PAYSLIPS");
  const r = await prisma.payrollRun.updateMany({
    where: { id: runId, schoolId: ctx.schoolId, status: "DRAFT" },
    data: { status: "VALIDATED", validatedById: ctx.userId, validatedAt: new Date() },
  });
  if (r.count === 0) return err("NOT_FOUND_OR_LOCKED");
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "payroll.run.validate", entity: "PayrollRun", entityId: runId });
  return ok({ id: runId });
}

export async function cancelRun(ctx: Ctx, runId: string) {
  if (!(await has(ctx, "payroll.manage"))) return err("FORBIDDEN");
  const r = await prisma.payrollRun.updateMany({
    where: { id: runId, schoolId: ctx.schoolId, status: "DRAFT" },
    data: { status: "CANCELLED" },
  });
  return r.count ? ok({ id: runId }) : err("NOT_FOUND_OR_LOCKED");
}

export async function getRun(ctx: Ctx, runId: string) {
  if (!(await has(ctx, "payroll.read"))) return err("FORBIDDEN");
  const run = await prisma.payrollRun.findFirst({
    where: { id: runId, schoolId: ctx.schoolId },
    include: {
      payslips: {
        include: { employee: { select: { matricule: true, firstName: true, lastName: true } } },
        orderBy: { employee: { lastName: "asc" } },
      },
    },
  });
  return run ? ok(run) : err("NOT_FOUND");
}

export async function getPayslip(ctx: Ctx, payslipId: string) {
  if (!(await has(ctx, "payroll.read"))) return err("FORBIDDEN");
  const p = await prisma.payslip.findFirst({
    where: { id: payslipId, run: { schoolId: ctx.schoolId } },
    include: { employee: true, run: { select: { periodStart: true, periodEnd: true, status: true } } },
  });
  return p ? ok(p) : err("NOT_FOUND");
}
