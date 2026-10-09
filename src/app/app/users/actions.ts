"use server";

import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/permissions/guard";
import { hashPassword } from "@/lib/auth/password";
import { redirect } from "next/navigation";
import {
  userCreateSchema,
  userUpdateSchema,
  type UserCreateInput,
  type UserUpdateInput,
} from "@/lib/validations/users";

export async function createUser(raw: UserCreateInput) {
  const tenant = await requirePermission("user.manage");

  const parsed = userCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false as const, error: "INVALID_INPUT" as const };
  }

  const input = parsed.data;
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.user.create({
      data: {
        schoolId: tenant.schoolId,
        email: input.email.toLowerCase().trim(),
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        status: input.status,
      },
      select: { id: true },
    });

    return { ok: true as const, result: { id: user.id } };
  } catch {
    return { ok: false as const, error: "CREATE_FAILED" as const };
  }
}

export async function updateUser(raw: UserUpdateInput) {
  const tenant = await requirePermission("user.manage");

  const parsed = userUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false as const, error: "INVALID_INPUT" as const };
  }

  const input = parsed.data;

  const existing = await prisma.user.findFirst({
    where: { id: input.id, schoolId: tenant.schoolId },
    select: { id: true },
  });

  if (!existing) {
    return { ok: false as const, error: "NOT_FOUND" as const };
  }

  try {
    await prisma.user.update({
      where: { id: input.id },
      data: {
        email: input.email.toLowerCase().trim(),
        firstName: input.firstName,
        lastName: input.lastName,
        status: input.status,
        ...(input.password
          ? { passwordHash: await hashPassword(input.password) }
          : {}),
      },
      select: { id: true },
    });

    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "UPDATE_FAILED" as const };
  }
}

export async function deleteUser(formData: FormData) {
  const tenant = await requirePermission("user.manage");

  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/app/users?error=INVALID_INPUT");

  if (id === tenant.userId) {
    redirect("/app/users?error=CANNOT_DELETE_SELF");
  }

  const existing = await prisma.user.findFirst({
    where: { id, schoolId: tenant.schoolId },
    select: { id: true },
  });

  if (!existing) {
    redirect("/app/users?error=NOT_FOUND");
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
    });
  } catch {
    redirect("/app/users?error=DELETE_FAILED");
  }

  redirect("/app/users");
}
