"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  generateClassReportCards,
  generateReportCard,
  rectifyReportCard,
} from "@/lib/services/grading/reportcards";
import { reportCardGenerateSchema } from "@/lib/validations/grading";

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

export async function generateClassReportCardsAction(formData: FormData) {
  const tenant = await requireSchoolPermission("reportcards.generate");
  const parsed = reportCardGenerateSchema.safeParse({
    classroomId: formData.get("classroomId"),
    academicPeriodId: formData.get("academicPeriodId"),
  });
  if (!parsed.success) redirect("/app/report-cards?error=INVALID_INPUT" as never);

  const res = await generateClassReportCards(ctx(tenant), parsed.data);
  const q = `classroom=${parsed.data.classroomId}&period=${parsed.data.academicPeriodId}`;
  redirect(
    (res.ok
      ? `/app/report-cards?ok=generated&count=${res.result.generated}&${q}`
      : `/app/report-cards?error=${res.error}&${q}`) as never,
  );
}

export async function generateReportCardAction(formData: FormData) {
  const tenant = await requireSchoolPermission("reportcards.generate");
  const studentId = String(formData.get("studentId") ?? "");
  const periodId = String(formData.get("academicPeriodId") ?? "");
  if (!studentId || !periodId) redirect("/app/report-cards?error=INVALID_INPUT" as never);
  const res = await generateReportCard(ctx(tenant), {
    studentId,
    academicPeriodId: periodId,
  });
  redirect(
    (res.ok ? "/app/report-cards?ok=generated" : `/app/report-cards?error=${res.error}`) as never,
  );
}

export async function rectifyReportCardAction(formData: FormData) {
  const tenant = await requireSchoolPermission("reportcards.validate");
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id || !reason) redirect("/app/report-cards?error=INVALID_INPUT" as never);
  const res = await rectifyReportCard(ctx(tenant), id, reason);
  redirect(
    (res.ok ? "/app/report-cards?ok=rectified" : `/app/report-cards?error=${res.error}`) as never,
  );
}
