"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { createLevel, updateLevel } from "@/lib/services/classes";
import { levelCreateSchema, levelUpdateSchema } from "@/lib/validations/classes";

function back(params: string): never {
  redirect(`/app/levels${params}` as never);
}

export async function createLevelAction(formData: FormData) {
  const tenant = await requireSchoolPermission("classroom.manage");

  const parsed = levelCreateSchema.safeParse({
    name: formData.get("name"),
    order: formData.get("order") ?? 0,
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

  const res = await createLevel(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    parsed.data,
  );
  back(res.ok ? "?ok=created" : `?error=${res.error}`);
}

export async function updateLevelAction(formData: FormData) {
  const tenant = await requireSchoolPermission("classroom.manage");

  const id = String(formData.get("id") ?? "");
  if (!id) back("?error=INVALID_INPUT");

  const parsed = levelUpdateSchema.safeParse({
    name: String(formData.get("name") ?? "") || undefined,
    order:
      formData.get("order") === null || formData.get("order") === ""
        ? undefined
        : formData.get("order"),
    status: String(formData.get("status") ?? "") || undefined,
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

  const res = await updateLevel(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
    parsed.data,
  );
  back(res.ok ? "?ok=updated" : `?error=${res.error}`);
}
