"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { createClassroom, updateClassroom } from "@/lib/services/classes";
import {
  classroomCreateSchema,
  classroomUpdateSchema,
} from "@/lib/validations/classes";

function back(params: string): never {
  redirect(`/app/classrooms${params}` as never);
}

export async function createClassroomAction(formData: FormData) {
  const tenant = await requireSchoolPermission("classroom.manage");

  const parsed = classroomCreateSchema.safeParse({
    name: formData.get("name"),
    academicYearId: formData.get("academicYearId"),
    levelId: formData.get("levelId"),
    section: String(formData.get("section") ?? "") || undefined,
    capacity:
      formData.get("capacity") === null || formData.get("capacity") === ""
        ? undefined
        : formData.get("capacity"),
    room: String(formData.get("room") ?? "") || undefined,
    headTeacherId: String(formData.get("headTeacherId") ?? "") || undefined,
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

  const res = await createClassroom(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    parsed.data,
  );
  back(res.ok ? "?ok=created" : `?error=${res.error}`);
}

export async function updateClassroomAction(formData: FormData) {
  const tenant = await requireSchoolPermission("classroom.manage");

  const id = String(formData.get("id") ?? "");
  if (!id) back("?error=INVALID_INPUT");

  const parsed = classroomUpdateSchema.safeParse({
    name: String(formData.get("name") ?? "") || undefined,
    levelId: String(formData.get("levelId") ?? "") || undefined,
    section: formData.get("section") === null ? undefined : String(formData.get("section") ?? ""),
    capacity:
      formData.get("capacity") === null
        ? undefined
        : String(formData.get("capacity") ?? "") === ""
          ? null
          : formData.get("capacity"),
    room: formData.get("room") === null ? undefined : String(formData.get("room") ?? ""),
    headTeacherId:
      formData.get("headTeacherId") === null
        ? undefined
        : String(formData.get("headTeacherId") ?? "") || null,
    status: String(formData.get("status") ?? "") || undefined,
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

  const res = await updateClassroom(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
    parsed.data,
  );
  back(
    res.ok
      ? `/${id}?ok=updated`
      : `/${id}?error=${res.error}`,
  );
}
