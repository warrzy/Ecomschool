"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import {
  createAssessment,
  setAssessmentStatus,
} from "@/lib/services/grading/assessments";
import { saveGrades, parseGradesCsv } from "@/lib/services/grading/grades";
import { prisma } from "@/lib/db/prisma";
import {
  assessmentCreateSchema,
  gradeStatusSchema,
} from "@/lib/validations/grading";
import type { AssessmentStatus, GradeStatus } from "@prisma/client";

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

const pick = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return v === null ? undefined : String(v) || undefined;
};

/** Enseignant : périmètre limité à ses affectations. */
async function asTeacher(userId: string, schoolId: string) {
  return !(await userHasSchoolPermission({
    userId,
    schoolId,
    permissionKey: "assessments.manage",
  }));
}

export async function createAssessmentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("assessments.create");
  const parsed = assessmentCreateSchema.safeParse({
    academicYearId: formData.get("academicYearId"),
    academicPeriodId: pick(formData, "academicPeriodId"),
    classroomId: formData.get("classroomId"),
    subjectId: formData.get("subjectId"),
    teacherId: pick(formData, "teacherId"),
    typeId: formData.get("typeId"),
    title: formData.get("title"),
    date: formData.get("date"),
    maxScore: pick(formData, "maxScore"),
    coefficient: pick(formData, "coefficient"),
    description: pick(formData, "description"),
  });
  if (!parsed.success) redirect("/app/grades?error=INVALID_INPUT" as never);

  const res = await createAssessment(
    ctx(tenant),
    {
      ...parsed.data,
      academicPeriodId: parsed.data.academicPeriodId ?? null,
      teacherId: parsed.data.teacherId ?? null,
      date: new Date(`${parsed.data.date}T00:00:00.000Z`),
    },
    { asTeacher: await asTeacher(tenant.userId, tenant.schoolId) },
  );
  redirect(
    (res.ok ? "/app/grades?ok=created" : `/app/grades?error=${res.error}`) as never,
  );
}

export async function setAssessmentStatusAction(formData: FormData) {
  // Action d'écriture (transition de statut) : une permission d'écriture est
  // exigée. Les non-titulaires de `assessments.manage` restent bornés à leurs
  // affectations via `asTeacher` côté service.
  const tenant = await requireSchoolPermission("assessments.create");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as AssessmentStatus;
  if (!id || !status) redirect("/app/grades?error=INVALID_INPUT" as never);

  const res = await setAssessmentStatus(ctx(tenant), id, status, {
    asTeacher: await asTeacher(tenant.userId, tenant.schoolId),
  });
  redirect(
    (res.ok ? "/app/grades?ok=status" : `/app/grades?error=${res.error}`) as never,
  );
}

export async function saveGradesAction(formData: FormData) {
  const tenant = await requireSchoolPermission("grades.enter");
  const assessmentId = String(formData.get("assessmentId") ?? "");
  if (!assessmentId) redirect("/app/grades?error=INVALID_INPUT" as never);

  const entries: { studentId: string; value: number | null; status: GradeStatus; observation: string | null }[] = [];
  for (const [key, v] of formData.entries()) {
    if (!key.startsWith("s_")) continue;
    const studentId = key.slice(2);
    const statusParsed = gradeStatusSchema.safeParse(String(v));
    if (!statusParsed.success) continue;
    const rawValue = pick(formData, `v_${studentId}`);
    const num = rawValue == null ? null : Number(rawValue.replace(",", "."));
    entries.push({
      studentId,
      value: num != null && Number.isFinite(num) ? num : null,
      status: statusParsed.data,
      observation: pick(formData, `o_${studentId}`) ?? null,
    });
  }

  const res = await saveGrades(ctx(tenant), assessmentId, entries, {
    asTeacher: await asTeacher(tenant.userId, tenant.schoolId),
  });
  redirect(
    (res.ok
      ? `/app/grades/${assessmentId}?ok=saved`
      : `/app/grades/${assessmentId}?error=${res.error}`) as never,
  );
}

export async function importGradesCsvAction(formData: FormData) {
  const tenant = await requireSchoolPermission("grades.enter");
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const csv = String(formData.get("csv") ?? "");
  if (!assessmentId || !csv.trim()) {
    redirect(`/app/grades/${assessmentId || ""}?error=INVALID_INPUT` as never);
  }

  const rows = parseGradesCsv(csv);
  const students = await prisma.student.findMany({
    where: {
      schoolId: tenant.schoolId,
      matricule: { in: rows.map((r) => r.matricule) },
    },
    select: { id: true, matricule: true },
  });
  const idByMat = new Map(students.map((s) => [s.matricule, s.id]));
  const entries = rows
    .filter((r) => idByMat.has(r.matricule))
    .map((r) => ({
      studentId: idByMat.get(r.matricule)!,
      value: r.value,
      status: (r.value == null ? "MISSING" : "ENTERED") as GradeStatus,
      observation: r.observation,
    }));

  const res = await saveGrades(ctx(tenant), assessmentId, entries, {
    asTeacher: await asTeacher(tenant.userId, tenant.schoolId),
  });
  redirect(
    (res.ok
      ? `/app/grades/${assessmentId}?ok=imported&count=${res.result.saved}`
      : `/app/grades/${assessmentId}?error=${res.error}`) as never,
  );
}
