"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  computeAndStore,
  setValidationStatus,
  computeAnnualResults,
} from "@/lib/services/grading/results";
import {
  computeResultsSchema,
  annualResultsSchema,
} from "@/lib/validations/grading";
import type { ResultStatus } from "@prisma/client";

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

export async function computeResultsAction(formData: FormData) {
  const tenant = await requireSchoolPermission("grades.calculate");
  const parsed = computeResultsSchema.safeParse({
    classroomId: formData.get("classroomId"),
    academicPeriodId: formData.get("academicPeriodId"),
  });
  if (!parsed.success) redirect("/app/averages?error=INVALID_INPUT" as never);

  const res = await computeAndStore(ctx(tenant), parsed.data);
  const q = `classroom=${parsed.data.classroomId}&period=${parsed.data.academicPeriodId}`;
  redirect(
    (res.ok ? `/app/averages?ok=computed&${q}` : `/app/averages?error=${res.error}&${q}`) as never,
  );
}

export async function setValidationStatusAction(formData: FormData) {
  const status = String(formData.get("status") ?? "") as ResultStatus;
  const perm =
    status === "PUBLISHED"
      ? "results.publish"
      : status === "VALIDATED" || status === "RECTIFIED"
        ? "results.validate"
        : "grades.calculate";
  const tenant = await requireSchoolPermission(perm);
  const parsed = computeResultsSchema.safeParse({
    classroomId: formData.get("classroomId"),
    academicPeriodId: formData.get("academicPeriodId"),
  });
  if (!parsed.success) redirect("/app/averages?error=INVALID_INPUT" as never);

  const res = await setValidationStatus(ctx(tenant), { ...parsed.data, status });
  const q = `classroom=${parsed.data.classroomId}&period=${parsed.data.academicPeriodId}`;
  redirect(
    (res.ok ? `/app/averages?ok=${status.toLowerCase()}&${q}` : `/app/averages?error=${res.error}&${q}`) as never,
  );
}

export async function computeAnnualAction(formData: FormData) {
  const tenant = await requireSchoolPermission("grades.calculate");
  const parsed = annualResultsSchema.safeParse({
    academicYearId: formData.get("academicYearId"),
  });
  if (!parsed.success) redirect("/app/averages?error=INVALID_INPUT" as never);

  const res = await computeAnnualResults(ctx(tenant), parsed.data.academicYearId);
  redirect(
    (res.ok
      ? `/app/averages?ok=annual&year=${parsed.data.academicYearId}`
      : `/app/averages?error=${res.error}`) as never,
  );
}
