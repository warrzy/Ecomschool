"use server";

import { revalidatePath } from "next/cache";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import * as svc from "@/lib/services/accounting";

export async function installPlanAction() {
  const t = await requireSchoolPermission("accounting.manage");
  await svc.installStarterPlan({ userId: t.userId, schoolId: t.schoolId });
  revalidatePath("/app/comptabilite");
}

export async function upsertAccountAction(fd: FormData) {
  const t = await requireSchoolPermission("accounting.manage");
  await svc.upsertAccount(
    { userId: t.userId, schoolId: t.schoolId },
    {
      code: String(fd.get("code") ?? ""),
      name: String(fd.get("name") ?? ""),
      classNumber: Number(fd.get("classNumber") ?? 0),
    },
  );
  revalidatePath("/app/comptabilite");
}

export async function upsertMappingAction(fd: FormData) {
  const t = await requireSchoolPermission("accounting.manage");
  await svc.upsertMapping(
    { userId: t.userId, schoolId: t.schoolId },
    {
      key: String(fd.get("key") ?? ""),
      accountId: String(fd.get("accountId") ?? ""),
      journalId: String(fd.get("journalId") ?? "") || null,
    },
  );
  revalidatePath("/app/comptabilite");
}

export async function openExerciseAction(fd: FormData) {
  const t = await requireSchoolPermission("accounting.manage");
  await svc.openExercise(
    { userId: t.userId, schoolId: t.schoolId },
    {
      name: String(fd.get("name") ?? ""),
      startDate: new Date(String(fd.get("startDate"))),
      endDate: new Date(String(fd.get("endDate"))),
    },
  );
  revalidatePath("/app/comptabilite");
}

export async function closeExerciseAction(fd: FormData) {
  const t = await requireSchoolPermission("accounting.manage");
  await svc.closeExercise(
    { userId: t.userId, schoolId: t.schoolId },
    String(fd.get("exerciseId") ?? ""),
  );
  revalidatePath("/app/comptabilite");
}

export async function generateAction() {
  const t = await requireSchoolPermission("accounting.manage");
  await svc.generateEntries({ userId: t.userId, schoolId: t.schoolId });
  revalidatePath("/app/comptabilite");
}

/** CG-1 : saisie manuelle d'une OD (journal, exercice, lignes JSON). */
export async function manualEntryAction(fd: FormData) {
  const t = await requireSchoolPermission("accounting.manage");
  const lines = JSON.parse(String(fd.get("lines") ?? "[]")) as {
    accountId: string; debit?: number; credit?: number; label?: string;
  }[];
  await svc.createManualEntry(
    { userId: t.userId, schoolId: t.schoolId },
    {
      journalId: String(fd.get("journalId") ?? ""),
      exerciseId: String(fd.get("exerciseId") ?? ""),
      date: new Date(String(fd.get("date") ?? "")),
      description: String(fd.get("description") ?? ""),
      lines,
    },
  );
  revalidatePath("/app/comptabilite");
}
