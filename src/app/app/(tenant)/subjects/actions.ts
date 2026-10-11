"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  createSubject,
  removeClassroomSubject,
  removeLevelCoefficient,
  setClassroomSubject,
  setLevelCoefficient,
  updateSubject,
} from "@/lib/services/subjects";
import {
  classroomSubjectSchema,
  levelCoefficientSchema,
  subjectCreateSchema,
  subjectUpdateSchema,
} from "@/lib/validations/subjects";

function back(params: string): never {
  redirect(`/app/subjects${params}` as never);
}

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

export async function createSubjectAction(formData: FormData) {
  const tenant = await requireSchoolPermission("subject.manage");

  const parsed = subjectCreateSchema.safeParse({
    name: formData.get("name"),
    code: String(formData.get("code") ?? "") || undefined,
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

  const res = await createSubject(ctx(tenant), parsed.data);
  back(res.ok ? "?ok=created" : `?error=${res.error}`);
}

export async function updateSubjectAction(formData: FormData) {
  const tenant = await requireSchoolPermission("subject.manage");

  const id = String(formData.get("id") ?? "");
  if (!id) back("?error=INVALID_INPUT");

  const parsed = subjectUpdateSchema.safeParse({
    name: String(formData.get("name") ?? "") || undefined,
    code: formData.get("code") === null ? undefined : String(formData.get("code") ?? ""),
    status: String(formData.get("status") ?? "") || undefined,
  });
  if (!parsed.success) back(`/${id}?error=INVALID_INPUT`);

  const res = await updateSubject(ctx(tenant), id, parsed.data);
  back(res.ok ? `/${id}?ok=updated` : `/${id}?error=${res.error}`);
}

export async function setLevelCoefficientAction(formData: FormData) {
  const tenant = await requireSchoolPermission("subject.manage");

  const parsed = levelCoefficientSchema.safeParse({
    subjectId: formData.get("subjectId"),
    levelId: formData.get("levelId"),
    coefficient: formData.get("coefficient"),
  });
  if (!parsed.success) {
    back(`/${String(formData.get("subjectId") ?? "")}?error=INVALID_INPUT`);
  }

  const res = await setLevelCoefficient(ctx(tenant), parsed.data);
  back(
    res.ok
      ? `/${parsed.data.subjectId}?ok=level`
      : `/${parsed.data.subjectId}?error=${res.error}`,
  );
}

export async function removeLevelCoefficientAction(formData: FormData) {
  const tenant = await requireSchoolPermission("subject.manage");

  const id = String(formData.get("linkId") ?? "");
  const subjectId = String(formData.get("subjectId") ?? "");
  if (!id || !subjectId) back("?error=INVALID_INPUT");

  const res = await removeLevelCoefficient(ctx(tenant), id);
  back(res.ok ? `/${subjectId}?ok=removed` : `/${subjectId}?error=${res.error}`);
}

export async function setClassroomSubjectAction(formData: FormData) {
  const tenant = await requireSchoolPermission("subject.manage");

  const returnTo = String(formData.get("returnTo") ?? "");
  const parsed = classroomSubjectSchema.safeParse({
    classroomId: formData.get("classroomId"),
    subjectId: formData.get("subjectId"),
    coefficient: formData.get("coefficient"),
    teacherId: String(formData.get("teacherId") ?? "") || undefined,
  });
  if (!parsed.success) {
    redirect(
      (returnTo
        ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=INVALID_INPUT`
        : "/app/subjects?error=INVALID_INPUT") as never,
    );
  }

  const res = await setClassroomSubject(ctx(tenant), parsed.data);
  redirect(
    (returnTo
      ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}${res.ok ? "ok=subject" : `error=${res.error}`}`
      : `/app/subjects${res.ok ? "?ok=subject" : `?error=${res.error}`}`) as never,
  );
}

export async function removeClassroomSubjectAction(formData: FormData) {
  const tenant = await requireSchoolPermission("subject.manage");

  const id = String(formData.get("linkId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/app/subjects");
  if (!id) redirect(`${returnTo}?error=INVALID_INPUT` as never);

  const res = await removeClassroomSubject(ctx(tenant), id);
  redirect(
    `${returnTo}${returnTo.includes("?") ? "&" : "?"}${res.ok ? "ok=removed" : `error=${res.error}`}` as never,
  );
}
