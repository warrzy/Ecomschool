"use server";

import { requireSchoolPermission } from "@/lib/permissions/guard";
import { redirect } from "next/navigation";
import {
  createSchoolUser,
  removeSchoolUser,
  updateSchoolUser,
} from "@/lib/services/users";
import { requestPasswordReset } from "@/lib/services/portal/accounts";
import {
  userCreateSchema,
  userUpdateSchema,
  type UserCreateInput,
  type UserUpdateInput,
} from "@/lib/validations/users";

export async function createUser(raw: UserCreateInput) {
  const tenant = await requireSchoolPermission("user.manage");

  const parsed = userCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false as const, error: "INVALID_INPUT" as const };
  }

  return createSchoolUser(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    parsed.data,
  );
}

export async function updateUser(raw: UserUpdateInput) {
  const tenant = await requireSchoolPermission("user.manage");

  const parsed = userUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false as const, error: "INVALID_INPUT" as const };
  }

  return updateSchoolUser(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    parsed.data,
  );
}

export async function deleteUser(formData: FormData) {
  const tenant = await requireSchoolPermission("user.manage");

  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/app/users?error=INVALID_INPUT");

  const res = await removeSchoolUser(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );

  if (!res.ok) {
    const code =
      res.error === "CANNOT_TARGET_SELF" ||
      res.error === "CANNOT_TARGET_PLATFORM_USER"
        ? res.error
        : res.error === "NOT_FOUND"
          ? "NOT_FOUND"
          : "DELETE_FAILED";
    redirect(`/app/users?error=${code}`);
  }

  redirect("/app/users");
}

export async function resetUserPassword(formData: FormData) {
  const tenant = await requireSchoolPermission("user.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/app/users?error=INVALID_INPUT");

  const res = await requestPasswordReset(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );
  redirect(
    (res.ok
      ? "/app/users?ok=reset"
      : `/app/users?error=${res.error}`) as never,
  );
}
