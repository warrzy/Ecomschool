"use server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { upsertComponent, createRun, computeRun, validateRun, cancelRun } from "@/lib/services/hr/payroll";
import { redirect } from "next/navigation";

const back = (p: string) => redirect(`/app/rh/paie${p}`);

export async function upsertComponentAction(fd: FormData) {
  const t = await requireSchoolPermission("payroll.manage");
  let formula: unknown;
  try { formula = JSON.parse(String(fd.get("formula"))); } catch { back("?err=JSON+invalide"); }
  const r = await upsertComponent({ userId: t.userId, schoolId: t.schoolId }, {
    code: String(fd.get("code") ?? ""), label: String(fd.get("label") ?? ""),
    kind: String(fd.get("kind")) as never,
    formula, order: Number(fd.get("order") ?? 0), activeFrom: new Date("2020-01-01"),
  });
  back(r.ok ? "?ok=Composant+enregistré" : `?err=${r.error}`);
}

export async function createRunAction(fd: FormData) {
  const t = await requireSchoolPermission("payroll.manage");
  const r = await createRun({ userId: t.userId, schoolId: t.schoolId }, {
    periodStart: new Date(String(fd.get("periodStart"))),
    periodEnd: new Date(String(fd.get("periodEnd"))),
  });
  back(r.ok ? `?run=${r.result.id}&ok=Campagne+créée` : `?err=${r.error}`);
}

export async function computeRunAction(fd: FormData) {
  const t = await requireSchoolPermission("payroll.manage");
  const id = String(fd.get("id"));
  const r = await computeRun({ userId: t.userId, schoolId: t.schoolId }, id);
  back(r.ok ? `?run=${id}&ok=${r.result.payslips}+bulletin(s)` : `?err=${r.error}`);
}

export async function validateRunAction(fd: FormData) {
  const t = await requireSchoolPermission("payroll.manage");
  const id = String(fd.get("id"));
  const r = await validateRun({ userId: t.userId, schoolId: t.schoolId }, id);
  back(r.ok ? `?run=${id}&ok=Campagne+validée` : `?err=${r.error}`);
}

export async function cancelRunAction(fd: FormData) {
  const t = await requireSchoolPermission("payroll.manage");
  const id = String(fd.get("id"));
  await cancelRun({ userId: t.userId, schoolId: t.schoolId }, id);
  back("?ok=Campagne+annulée");
}

export async function postPayrollAction(fd: FormData) {
  const t = await requireSchoolPermission("payroll.manage");
  const { postPayrollToAccounting } = await import("@/lib/services/hr/payrollPosting");
  const id = String(fd.get("id"));
  const r = await postPayrollToAccounting({ userId: t.userId, schoolId: t.schoolId }, id);
  back(r.ok ? `?run=${id}&ok=OD+de+paie+comptabilisée` : `?err=${r.error}`);
}

export async function rectifyRunAction(fd: FormData) {
  const t = await requireSchoolPermission("payroll.manage");
  const { rectifyRun } = await import("@/lib/services/hr/payrollPosting");
  const id = String(fd.get("id"));
  const r = await rectifyRun({ userId: t.userId, schoolId: t.schoolId }, id);
  back(r.ok ? `?run=${r.result.newRunId}&ok=Rectification+créée` : `?err=${r.error}`);
}
