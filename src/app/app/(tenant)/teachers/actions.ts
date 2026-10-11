"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  activateTeacherAccount,
  assignTeacher,
  createTeacher,
  removeAssignment,
  updateTeacher,
} from "@/lib/services/teachers";
import {
  assignmentCreateSchema,
  teacherAccountSchema,
  teacherCreateSchema,
  teacherUpdateSchema,
} from "@/lib/validations/teachers";

function back(params: string): never {
  redirect(`/app/teachers${params}` as never);
}

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

export async function createTeacherAction(formData: FormData) {
  const tenant = await requireSchoolPermission("teacher.manage");

  const parsed = teacherCreateSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: String(formData.get("email") ?? "") || undefined,
    phone: String(formData.get("phone") ?? "") || undefined,
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

  const res = await createTeacher(ctx(tenant), parsed.data);
  back(res.ok ? "?ok=created" : `?error=${res.error}`);
}

export async function updateTeacherAction(formData: FormData) {
  const tenant = await requireSchoolPermission("teacher.manage");

  const id = String(formData.get("id") ?? "");
  if (!id) back("?error=INVALID_INPUT");

  const parsed = teacherUpdateSchema.safeParse({
    firstName: String(formData.get("firstName") ?? "") || undefined,
    lastName: String(formData.get("lastName") ?? "") || undefined,
    email: formData.get("email") === null ? undefined : String(formData.get("email") ?? ""),
    phone: formData.get("phone") === null ? undefined : String(formData.get("phone") ?? ""),
    status: String(formData.get("status") ?? "") || undefined,
  });
  if (!parsed.success) back(`/${id}?error=INVALID_INPUT`);

  const res = await updateTeacher(ctx(tenant), id, parsed.data);
  back(res.ok ? `/${id}?ok=updated` : `/${id}?error=${res.error}`);
}

export async function assignTeacherAction(formData: FormData) {
  const tenant = await requireSchoolPermission("teacher.manage");

  const parsed = assignmentCreateSchema.safeParse({
    teacherId: formData.get("teacherId"),
    classroomId: formData.get("classroomId"),
    subjectId: String(formData.get("subjectId") ?? "") || undefined,
    academicYearId: formData.get("academicYearId"),
  });
  if (!parsed.success) {
    back(`/${String(formData.get("teacherId") ?? "")}?error=INVALID_INPUT`);
  }

  const res = await assignTeacher(ctx(tenant), parsed.data);
  back(
    res.ok
      ? `/${parsed.data.teacherId}?ok=assigned`
      : `/${parsed.data.teacherId}?error=${res.error}`,
  );
}

export async function removeAssignmentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("teacher.manage");

  const id = String(formData.get("assignmentId") ?? "");
  const teacherId = String(formData.get("teacherId") ?? "");
  if (!id || !teacherId) back("?error=INVALID_INPUT");

  const res = await removeAssignment(ctx(tenant), id);
  back(
    res.ok ? `/${teacherId}?ok=removed` : `/${teacherId}?error=${res.error}`,
  );
}

export async function activateTeacherAccountAction(formData: FormData) {
  const tenant = await requireSchoolPermission("teacher.manage");

  const parsed = teacherAccountSchema.safeParse({
    teacherId: formData.get("teacherId"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    back(`/${String(formData.get("teacherId") ?? "")}?error=INVALID_INPUT`);
  }

  const res = await activateTeacherAccount(ctx(tenant), parsed.data);
  back(
    res.ok
      ? `/${parsed.data.teacherId}?ok=account`
      : `/${parsed.data.teacherId}?error=${res.error}`,
  );
}
