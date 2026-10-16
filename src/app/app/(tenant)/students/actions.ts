"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  createStudent,
  updateStudent,
} from "@/lib/services/students";
import {
  studentCreateSchema,
  studentUpdateSchema,
} from "@/lib/validations/students";

function back(params: string): never {
  redirect(`/app/students${params}` as never);
}

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

const pick = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return v === null ? undefined : String(v) || undefined;
};

export async function createStudentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("student.manage");

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
    photoUrl: pick(formData, "photoUrl"),
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

  const res = await createStudent(ctx(tenant), parsed.data);
  back(res.ok ? "?ok=created" : `?error=${res.error}`);
}

export async function updateStudentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("student.manage");

  const id = String(formData.get("id") ?? "");
  if (!id) back("?error=INVALID_INPUT");

  const parsed = studentUpdateSchema.safeParse({
    matricule: pick(formData, "matricule"),
    lastName: pick(formData, "lastName"),
    firstName: pick(formData, "firstName"),
    sex: pick(formData, "sex"),
    birthDate: pick(formData, "birthDate"),
    birthPlace: pick(formData, "birthPlace"),
    phone: pick(formData, "phone"),
    email: pick(formData, "email"),
    address: pick(formData, "address"),
    photoUrl: pick(formData, "photoUrl"),
    status: pick(formData, "status"),
  });
  if (!parsed.success) back(`/${id}?error=INVALID_INPUT`);

  const res = await updateStudent(ctx(tenant), id, parsed.data);
  back(res.ok ? `/${id}?ok=updated` : `/${id}?error=${res.error}`);
}

