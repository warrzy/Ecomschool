"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  closeYear,
  createYear,
  setCurrentYear,
  updatePeriod,
} from "@/lib/services/academic";
import { yearCreateSchema, periodUpdateSchema } from "@/lib/validations/academic";

function ctxOf(tenant: { userId: string; schoolId: string }) {
  return { userId: tenant.userId, schoolId: tenant.schoolId };
}

export async function createYearAction(formData: FormData) {
  const tenant = await requireSchoolPermission("academic.manage");

  const parsed = yearCreateSchema.safeParse({
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    periodType: formData.get("periodType"),
    isCurrent: formData.get("isCurrent") === "on",
  });
  if (!parsed.success) redirect("/app/academic-years?error=INVALID_INPUT");

  const res = await createYear(ctxOf(tenant), parsed.data);
  redirect(
    res.ok
      ? "/app/academic-years?ok=created"
      : `/app/academic-years?error=${res.error}`,
  );
}

export async function setCurrentYearAction(formData: FormData) {
  const tenant = await requireSchoolPermission("academic.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/app/academic-years?error=INVALID_INPUT");

  const res = await setCurrentYear(ctxOf(tenant), id);
  redirect(
    res.ok
      ? "/app/academic-years?ok=current"
      : `/app/academic-years?error=${res.error}`,
  );
}

export async function closeYearAction(formData: FormData) {
  const tenant = await requireSchoolPermission("academic.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/app/academic-years?error=INVALID_INPUT");

  const res = await closeYear(ctxOf(tenant), id);
  redirect(
    res.ok
      ? "/app/academic-years?ok=closed"
      : `/app/academic-years?error=${res.error}`,
  );
}

export async function updatePeriodAction(formData: FormData) {
  const tenant = await requireSchoolPermission("academic.manage");

  const periodId = String(formData.get("periodId") ?? "");
  const yearId = String(formData.get("yearId") ?? "");
  if (!periodId || !yearId) {
    redirect("/app/academic-years?error=INVALID_INPUT");
  }

  const parsed = periodUpdateSchema.safeParse({
    name: String(formData.get("name") ?? "") || undefined,
    startDate: String(formData.get("startDate") ?? "") || undefined,
    endDate: String(formData.get("endDate") ?? "") || undefined,
    isLocked: formData.get("isLocked") === "on",
  });
  if (!parsed.success) {
    redirect(`/app/academic-years/${yearId}/periods?error=INVALID_INPUT`);
  }

  const res = await updatePeriod(ctxOf(tenant), periodId, parsed.data);
  redirect(
    res.ok
      ? `/app/academic-years/${yearId}/periods?ok=updated`
      : `/app/academic-years/${yearId}/periods?error=${res.error}`,
  );
}
