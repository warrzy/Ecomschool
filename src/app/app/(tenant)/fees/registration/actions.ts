"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { registerStudent } from "@/lib/services/registration";
import { studentCreateSchema } from "@/lib/validations/students";
import { idField, optionalText } from "@/lib/validations/form";
import { z } from "zod";

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

const back = (path: string): never => redirect(path as never);

const pick = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return v === null ? undefined : String(v) || undefined;
};

const target = (studentId: string, yearId: string, extra = "") =>
  `/app/fees/accounts/${studentId}?year=${yearId}${extra}`;

const okCode = (r: {
  noTariffs: boolean;
  alreadyEnrolled: boolean;
  chargesError: string | null;
}) =>
  r.chargesError
    ? "registered_charges_failed"
    : r.noTariffs
      ? "registered_no_tariffs"
      : r.alreadyEnrolled
        ? "charges_checked"
        : "registered";

// ---------- Parcours A : nouvel élève ----------

export async function registerNewStudentAction(formData: FormData) {
  // Deux gardes distinctes : la création de fiche ET l'inscription sont
  // chacune protégées par leur permission fine (ni student.manage ni
  // enrollment.manage ne sont exigées des profils financiers).
  const t1 = await requireSchoolPermission("student.create");
  const tenant = await requireSchoolPermission("enrollment.create");
  if (t1.schoolId !== tenant.schoolId || t1.userId !== tenant.userId) {
    back("/app/forbidden");
  }

  const parsed = studentCreateSchema.safeParse({
    matricule: formData.get("matricule"),
    lastName: formData.get("lastName"),
    firstName: formData.get("firstName"),
    sex: pick(formData, "sex"),
    birthDate: pick(formData, "birthDate"),
    birthPlace: pick(formData, "birthPlace"),
    phone: pick(formData, "phone"),
    email: pick(formData, "email"),
    address: pick(formData, "address"),
  });
  const enrollment = z
    .object({ classroomId: idField, academicYearId: optionalText })
    .safeParse({
      classroomId: formData.get("classroomId"),
      academicYearId: formData.get("academicYearId"),
    });
  if (!parsed.success || !enrollment.success) {
    return back("/app/fees/registration?error=INVALID_INPUT");
  }

  const res = await registerStudent(ctx(tenant), {
    student: parsed.data,
    classroomId: enrollment.data.classroomId,
    academicYearId: enrollment.data.academicYearId || undefined,
  });
  if (!res.ok) {
    return back(`/app/fees/registration?error=${res.error}`);
  }
  const r = res.result;
  back(target(r.studentId, r.academicYearId, `&ok=${okCode(r)}`));
}

// ---------- Parcours B : élève existant ----------

export async function registerExistingStudentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("enrollment.create");

  const parsed = z
    .object({
      studentId: idField,
      classroomId: idField,
      academicYearId: optionalText,
    })
    .safeParse({
      studentId: formData.get("studentId"),
      classroomId: formData.get("classroomId"),
      academicYearId: formData.get("academicYearId"),
    });
  if (!parsed.success) {
    return back("/app/fees/registration?error=INVALID_INPUT");
  }

  const res = await registerStudent(ctx(tenant), {
    studentId: parsed.data.studentId,
    classroomId: parsed.data.classroomId,
    academicYearId: parsed.data.academicYearId || undefined,
  });
  if (!res.ok) {
    return back(`/app/fees/registration?error=${res.error}`);
  }
  const r = res.result;
  back(target(r.studentId, r.academicYearId, `&ok=${okCode(r)}`));
}
