"use server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { importStatement, autoMatch, unmatch } from "@/lib/services/accounting/reconciliation";
import { redirect } from "next/navigation";

const back = (id: string, p: string) => redirect(`/app/comptabilite/rapprochement?id=${id}${p}`);

export async function importStatementAction(fd: FormData) {
  const t = await requireSchoolPermission("accounting.manage");
  const lines = String(fd.get("lines") ?? "").split("\n")
    .map((x) => x.trim()).filter(Boolean)
    .map((x) => {
      const [d, label, amt] = x.split(";");
      return { date: new Date(d), label: (label ?? "").trim(), amount: Number(amt) };
    });
  const r = await importStatement({ userId: t.userId, schoolId: t.schoolId }, {
    journalId: String(fd.get("journalId")),
    periodStart: new Date(String(fd.get("periodStart"))),
    periodEnd: new Date(String(fd.get("periodEnd"))),
    closingBalance: Number(fd.get("closingBalance")),
    lines,
  });
  if (!r.ok) redirect(`/app/comptabilite/rapprochement?err=${r.error}`);
  back(r.result.id, "&ok=Relevé+importé");
}

export async function autoMatchAction(fd: FormData) {
  const t = await requireSchoolPermission("accounting.manage");
  const id = String(fd.get("id"));
  const r = await autoMatch({ userId: t.userId, schoolId: t.schoolId }, id);
  back(id, r.ok ? `&ok=${r.result.matched}+ligne(s)+pointée(s)` : `&err=${r.error}`);
}

export async function unmatchAction(fd: FormData) {
  const t = await requireSchoolPermission("accounting.manage");
  await unmatch({ userId: t.userId, schoolId: t.schoolId }, String(fd.get("line")));
  redirect("/app/comptabilite/rapprochement?ok=Pointage+retiré");
}
