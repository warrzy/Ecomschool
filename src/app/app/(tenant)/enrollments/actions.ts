"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  closeEnrollment,
  enrollStudent,
  transferStudent,
} from "@/lib/services/enrollments";
import {
  enrollmentCloseSchema,
  enrollmentCreateSchema,
  enrollmentTransferSchema,
} from "@/lib/validations/enrollments";

function back(params: string): never {
  redirect(`/app/enrollments${params}` as never);
}

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

export async function enrollStudentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("enrollment.manage");

  const parsed = enrollmentCreateSchema.safeParse({
    studentId: formData.get("studentId"),
    classroomId: formData.get("classroomId"),
    academicYearId: String(formData.get("academicYearId") ?? "") || undefined,
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

  const res = await enrollStudent(ctx(tenant), parsed.data);
  back(res.ok ? "?ok=enrolled" : `?error=${res.error}`);
}

export async function transferStudentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("enrollment.manage");

  const parsed = enrollmentTransferSchema.safeParse({
    enrollmentId: formData.get("enrollmentId"),
    toClassroomId: formData.get("toClassroomId"),
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

  const res = await transferStudent(ctx(tenant), parsed.data);
  back(res.ok ? "?ok=transferred" : `?error=${res.error}`);
}

export async function closeEnrollmentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("enrollment.manage");

  const parsed = enrollmentCloseSchema.safeParse({
    enrollmentId: formData.get("enrollmentId"),
    status: formData.get("status"),
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

  const res = await closeEnrollment(ctx(tenant), parsed.data);
  back(res.ok ? `?ok=${parsed.data.status.toLowerCase()}` : `?error=${res.error}`);
}
