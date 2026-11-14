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
  | { type: "rate_x_qty"; rate: number; qty: number | "days_worked" }
  | { type: "table"; base: string; brackets: { upTo: number; rate: number }[] };

function validateFormula(f: unknown): f is Formula {
  if (typeof f !== "object" || f === null) return false;
  const x = f as Record<string, unknown>;
  if (x.type === "fixed") return typeof x.amount === "number" && x.amount >= 0;
  if (x.type === "percent") return typeof x.rate === "number" && x.rate >= 0 && x.rate <= 1 && typeof x.base === "string";
  if (x.type === "rate_x_qty") return typeof x.rate === "number" && x.rate >= 0
    && (x.qty === "days_worked" || (typeof x.qty === "number" && x.qty >= 0));
  if (x.type === "table") return typeof x.base === "string" && Array.isArray(x.brackets)
    && (x.brackets as unknown[]).every((b) => typeof (b as { upTo?: unknown }).upTo === "number" && typeof (b as { rate?: unknown }).rate === "number");
  return false;
}

/** Évalue une formule dans le contexte des bases nommées — pur, sans effet de bord. */
export function evalFormula(f: Formula, bases: Map<string, number>): number {
  const base = (name: string) => bases.get(name) ?? 0;
  if (f.type === "fixed") return f.amount;
  if (f.type === "percent") return Math.round(base(f.base) * f.rate);
  if (f.type === "rate_x_qty") return Math.round(f.rate * (f.qty === "days_worked" ? base("days_worked") : f.qty));
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
  // M8 : configuration d'assiduité de l'établissement (toutes valeurs
  // indicatives configurables — aucune règle légale présumée).
  const cfg = await prisma.payrollConfig.findUnique({
    where: { schoolId: ctx.schoolId },
    select: { workdaysPerMonth: true, prorateUnpaidLeave: true, prorateAbsences: true, advanceCapBp: true },
  });
  const workdays = Math.max(1, cfg?.workdaysPerMonth ?? 30);
  await prisma.$transaction(async (tx) => {
    // Recalcul DRAFT : restaurer les avances déjà recouvrées par le calcul précédent.
    const oldSlips = await tx.payslip.findMany({ where: { runId: run.id }, select: { id: true } });
    const oldRecs = await tx.advanceRecovery.findMany({
      where: { payslipId: { in: oldSlips.map((s) => s.id) } },
    });
    for (const r of oldRecs) {
      await tx.advance.update({
        where: { id: r.advanceId },
        data: { remaining: { increment: r.amount }, status: "RECOVERING" },
      });
    }
    await tx.advanceRecovery.deleteMany({ where: { id: { in: oldRecs.map((r) => r.id) } } });
    await tx.payslip.deleteMany({ where: { runId: run.id } });
    for (const e of employees) {
      const contract = e.contracts[0];
      if (!contract) continue; // pas de contrat actif sur la période → signalé par absence de bulletin
      // RH-8 : vacationnaire → base = taux/séance × séances DONE vérifiées (CourseSession).
      let base = contract.baseSalary;
      const lines: { code: string; label: string; kind: string; amount: number; formula: unknown }[] = [];
      if (contract.type === "VACATION" && e.teacherId) {
        const sessions = await tx.courseSession.count({
          where: { schoolId: ctx.schoolId, teacherId: e.teacherId, status: "DONE", date: { gte: run.periodStart, lte: run.periodEnd } },
        });
        base = contract.baseSalary * sessions;
        lines.push({ code: "SEANCES", label: `Vacations : ${sessions} séance(s) assurée(s)`, kind: "EARNING", amount: base, formula: { type: "rate_x_qty", rate: contract.baseSalary, qty: sessions } });
      }
      // M8 : jours non travaillés = congés UNPAID approuvés ∩ période
      // (si prorateUnpaidLeave) + absences pointées (si prorateAbsences).
      let unpaidDays = 0;
      if (cfg?.prorateUnpaidLeave ?? true) {
        const leaves = await tx.leaveRequest.findMany({
          where: {
            schoolId: ctx.schoolId, employeeId: e.id,
            type: "UNPAID", status: "APPROVED",
            startDate: { lte: run.periodEnd }, endDate: { gte: run.periodStart },
          },
          select: { startDate: true, endDate: true, days: true },
        });
        for (const l of leaves) {
          const s = Math.max(+l.startDate, +run.periodStart);
          const en = Math.min(+l.endDate, +run.periodEnd);
          const overlap = en >= s ? Math.floor((en - s) / 86400000) + 1 : 0;
          unpaidDays += Math.min(l.days, overlap);
        }
      }
      if (cfg?.prorateAbsences ?? false) {
        unpaidDays += await tx.staffAttendance.count({
          where: {
            schoolId: ctx.schoolId, employeeId: e.id, status: "ABSENT",
            date: { gte: run.periodStart, lte: run.periodEnd },
          },
        });
      }
      unpaidDays = Math.min(unpaidDays, workdays);
      const daysWorked = workdays - unpaidDays;
      const bases = new Map<string, number>([["base_salary", base], ["days_worked", daysWorked]]);
      let gross = base, deductions = 0, employerCost = 0;
      bases.set("gross", gross);
      for (const c of components) {
        const amount = evalFormula(c.formula as unknown as Formula, bases);
        lines.push({ code: c.code, label: c.label, kind: c.kind, amount, formula: c.formula });
        bases.set(c.code, amount);
        if (c.kind === "EARNING") { gross += amount; bases.set("gross", gross); }
        if (c.kind === "DEDUCTION") deductions += amount;
        if (c.kind === "EMPLOYER_CHARGE") employerCost += amount;
      }
      // M8 : retenue pour absences non payées — après les composants pour
      // que le brut reste le salaire contractuel + gains (présentation
      // classique : brut plein, retenue visible sur le bulletin).
      if (unpaidDays > 0 && contract.type !== "VACATION") {
        const absenceAmount = base - Math.round((base * daysWorked) / workdays);
        if (absenceAmount > 0) {
          lines.push({
            code: "ABS_NP",
            label: `Absences non payées : ${unpaidDays} j / ${workdays}`,
            kind: "DEDUCTION", amount: absenceAmount,
            formula: { type: "absence_prorata", unpaidDays, workdays },
          });
          deductions += absenceAmount;
        }
      }
      // RH-4 : recouvrement des avances — plafond configurable (PayrollConfig.advanceCapBp,
      // 3000 pb = 30 % par défaut, valeur indicative non réglementaire), FIFO par date.
      const capBp = cfg?.advanceCapBp ?? 3000;
      let net = gross - deductions;
      const cap = Math.floor((net * capBp) / 10000);
      let recovered = 0;
      const advances = await tx.advance.findMany({
        where: { employeeId: e.id, schoolId: ctx.schoolId, remaining: { gt: 0 }, status: { in: ["GRANTED", "RECOVERING"] } },
        orderBy: { date: "asc" },
      });
      for (const a of advances) {
        if (recovered >= cap) break;
        const take = Math.min(a.remaining, cap - recovered);
        recovered += take;
        lines.push({ code: "AVANCE", label: `Recouvrement avance du ${a.date.toISOString().slice(0, 10)}`, kind: "DEDUCTION", amount: take, formula: { type: "fixed", amount: take } });
      }
      net -= recovered;
      deductions += recovered;
      const slip = await tx.payslip.create({
        data: {
          runId: run.id, employeeId: e.id, contractId: contract.id,
          baseSalary: base, gross, deductions, employerCost, net,
          daysWorked, unpaidDays,
          lines: lines as unknown as Prisma.InputJsonValue,
          formulaSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      });
      let left = recovered;
      for (const a of advances) {
        if (left <= 0) break;
        const take = Math.min(a.remaining, left);
        left -= take;
        const newRemaining = a.remaining - take;
        await tx.advance.update({ where: { id: a.id }, data: { remaining: newRemaining, status: newRemaining === 0 ? "RECOVERED" : "RECOVERING" } });
        await tx.advanceRecovery.create({ data: { advanceId: a.id, payslipId: slip.id, amount: take } });
      }
    }
  });
  const n = await prisma.payslip.count({ where: { runId: run.id } });
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "payroll.run.compute", entity: "PayrollRun", entityId: runId, metadata: { payslips: n } });
  return ok({ payslips: n });
}

/** Configuration paie de l'établissement — plafond avances en points de base (3000 = 30 %, indicatif non réglementaire). */
export async function getPayrollConfig(ctx: Ctx) {
  if (!(await has(ctx, "payroll.read"))) return err("FORBIDDEN");
  const c = await prisma.payrollConfig.findUnique({ where: { schoolId: ctx.schoolId } });
  return ok({
    advanceCapBp: c?.advanceCapBp ?? 3000,
    workdaysPerMonth: c?.workdaysPerMonth ?? 30,
    prorateUnpaidLeave: c?.prorateUnpaidLeave ?? true,
    prorateAbsences: c?.prorateAbsences ?? false,
  });
}

/** M8 : configuration assiduité — valeurs indicatives, aucune règle légale présumée. */
export async function setAttendanceConfig(
  ctx: Ctx,
  input: { workdaysPerMonth: number; prorateUnpaidLeave: boolean; prorateAbsences: boolean },
) {
  if (!(await has(ctx, "payroll.manage"))) return err("FORBIDDEN");
  if (!Number.isInteger(input.workdaysPerMonth) || input.workdaysPerMonth < 1 || input.workdaysPerMonth > 31)
    return err("INVALID_INPUT");
  await prisma.payrollConfig.upsert({
    where: { schoolId: ctx.schoolId },
    create: { schoolId: ctx.schoolId, ...input },
    update: input,
  });
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "payroll.config.set_attendance", entity: "PayrollConfig", metadata: input });
  return ok(input);
}

export async function setAdvanceCap(ctx: Ctx, advanceCapBp: number) {
  if (!(await has(ctx, "payroll.manage"))) return err("FORBIDDEN");
  if (!Number.isInteger(advanceCapBp) || advanceCapBp < 0 || advanceCapBp > 10000) return err("INVALID_INPUT");
  await prisma.payrollConfig.upsert({
    where: { schoolId: ctx.schoolId },
    create: { schoolId: ctx.schoolId, advanceCapBp },
    update: { advanceCapBp },
  });
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "payroll.config.set_cap", entity: "PayrollConfig", metadata: { advanceCapBp } });
  return ok({ advanceCapBp });
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
  // Oracle scopé tenant : un runId d'une autre école ne doit jamais
  // valider sur les bulletins d'ICI (runId est unique, la garde ci-dessous
  // fait foi — le count scopé évite un oracle par timing).
  const n = await prisma.payslip.count({ where: { runId, run: { schoolId: ctx.schoolId } } });
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

// ---------- RH-4 : avances ----------

export async function grantAdvance(ctx: Ctx, employeeId: string, input: { amount: number; date: Date; reason?: string }) {
  if (!(await has(ctx, "payroll.manage"))) return err("FORBIDDEN");
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, schoolId: ctx.schoolId, status: "ACTIVE" }, select: { id: true } });
  if (!emp || input.amount <= 0) return err("INVALID_INPUT");
  const a = await prisma.advance.create({
    data: { schoolId: ctx.schoolId, employeeId, amount: input.amount, remaining: input.amount, date: input.date, reason: input.reason ?? null },
  });
  await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId, action: "payroll.advance.grant", entity: "Advance", entityId: a.id, metadata: { amount: input.amount } });
  return ok({ id: a.id });
}

export async function listAdvances(ctx: Ctx, employeeId?: string) {
  if (!(await has(ctx, "payroll.read"))) return err("FORBIDDEN");
  return ok(await prisma.advance.findMany({
    where: { schoolId: ctx.schoolId, ...(employeeId ? { employeeId } : {}) },
    include: { employee: { select: { matricule: true, firstName: true, lastName: true } }, recoveries: true },
    orderBy: { date: "desc" },
  }));
}

export async function cancelAdvance(ctx: Ctx, advanceId: string) {
  if (!(await has(ctx, "payroll.manage"))) return err("FORBIDDEN");
  const a = await prisma.advance.findFirst({ where: { id: advanceId, schoolId: ctx.schoolId }, include: { recoveries: { select: { id: true } } } });
  if (!a || a.recoveries.length > 0) return err("NOT_FOUND_OR_LOCKED");
  await prisma.advance.update({ where: { id: a.id }, data: { status: "CANCELLED", remaining: 0 } });
  return ok({ id: advanceId });
}
