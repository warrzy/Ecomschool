"use server";

import { redirect } from "next/navigation";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import {
  platformCreateSchoolAdmin,
  platformSetSchoolStatus,
  platformUpdateSchool,
} from "@/lib/services/schools";
import {
  platformSchoolUpdateSchema,
  schoolAdminCreateSchema,
} from "@/lib/validations/schools";

function back(id: string, q: string): never {
  redirect(`/platform/schools/${id}?${q}` as never);
}

export async function updateSchoolAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.schools.manage");

  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/platform/schools?error=INVALID_INPUT" as never);

  const parsed = platformSchoolUpdateSchema.safeParse({
    name: String(formData.get("name") ?? "") || undefined,
    code: String(formData.get("code") ?? "") || undefined,
    address: formData.get("address"),
    city: formData.get("city"),
    country: String(formData.get("country") ?? "") || undefined,
    phone: formData.get("phone"),
    email: formData.get("email"),
    website: formData.get("website"),
    logoUrl: formData.get("logoUrl"),
    type: String(formData.get("type") ?? "") || null,
    schoolSystem: String(formData.get("schoolSystem") ?? "") || null,
  });

  if (!parsed.success) back(id, "error=INVALID_INPUT");

  const res = await platformUpdateSchool(ctx.userId, id, parsed.data);
  if (!res.ok) back(id, `error=${res.error}`);

  back(id, "ok=updated");
}

export async function setSchoolStatusAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.schools.manage");

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || (status !== "ACTIVE" && status !== "INACTIVE")) {
    redirect("/platform/schools?error=INVALID_INPUT" as never);
  }

  const res = await platformSetSchoolStatus(ctx.userId, id, status);
  if (!res.ok) back(id, `error=${res.error}`);

  back(id, "ok=status");
}

export async function createSchoolAdminAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.users.manage");

  const schoolId = String(formData.get("schoolId") ?? "");
  if (!schoolId) redirect("/platform/schools?error=INVALID_INPUT" as never);

  const parsed = schoolAdminCreateSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
  });
  if (!parsed.success) back(schoolId, "error=INVALID_INPUT");

  const res = await platformCreateSchoolAdmin(ctx.userId, schoolId, parsed.data);
  if (!res.ok) back(schoolId, `error=${res.error}`);

  back(schoolId, "ok=admin-created");
}
