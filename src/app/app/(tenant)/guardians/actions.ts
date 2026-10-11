"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  createGuardian,
  linkGuardianToStudent,
  unlinkGuardian,
  updateGuardian,
} from "@/lib/services/guardians";
import {
  guardianCreateAndLinkSchema,
  guardianCreateSchema,
  guardianLinkSchema,
  guardianUpdateSchema,
} from "@/lib/validations/guardians";

function back(params: string): never {
  redirect(`/app/guardians${params}` as never);
}

function backToStudent(studentId: string, params: string): never {
  redirect(`/app/students/${studentId}${params}` as never);
}

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

export async function createGuardianAction(formData: FormData) {
  const tenant = await requireSchoolPermission("guardian.manage");

  const parsed = guardianCreateSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    phone: String(formData.get("phone") ?? "") || undefined,
    email: String(formData.get("email") ?? "") || undefined,
    address: String(formData.get("address") ?? "") || undefined,
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

  const res = await createGuardian(ctx(tenant), parsed.data);
  back(res.ok ? "?ok=created" : `?error=${res.error}`);
}

export async function updateGuardianAction(formData: FormData) {
  const tenant = await requireSchoolPermission("guardian.manage");

  const id = String(formData.get("id") ?? "");
  if (!id) back("?error=INVALID_INPUT");

  const parsed = guardianUpdateSchema.safeParse({
    firstName: String(formData.get("firstName") ?? "") || undefined,
    lastName: String(formData.get("lastName") ?? "") || undefined,
    phone: formData.get("phone") === null ? undefined : String(formData.get("phone") ?? ""),
    email: formData.get("email") === null ? undefined : String(formData.get("email") ?? ""),
    address: formData.get("address") === null ? undefined : String(formData.get("address") ?? ""),
    status: String(formData.get("status") ?? "") || undefined,
  });
  if (!parsed.success) back(`/${id}?error=INVALID_INPUT`);

  const res = await updateGuardian(ctx(tenant), id, parsed.data);
  back(res.ok ? `/${id}?ok=updated` : `/${id}?error=${res.error}`);
}

export async function linkGuardianAction(formData: FormData) {
  const tenant = await requireSchoolPermission("guardian.manage");

  const parsed = guardianLinkSchema.safeParse({
    studentId: formData.get("studentId"),
    guardianId: formData.get("guardianId"),
    relation: formData.get("relation"),
  });
  if (!parsed.success) backToStudent(String(formData.get("studentId") ?? ""), "?error=INVALID_INPUT");

  const res = await linkGuardianToStudent(ctx(tenant), parsed.data);
  backToStudent(
    parsed.data.studentId,
    res.ok ? "?ok=linked" : `?error=${res.error}`,
  );
}

export async function createAndLinkGuardianAction(formData: FormData) {
  const tenant = await requireSchoolPermission("guardian.manage");

  const parsed = guardianCreateAndLinkSchema.safeParse({
    studentId: formData.get("studentId"),
    relation: formData.get("relation"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    phone: String(formData.get("phone") ?? "") || undefined,
    email: String(formData.get("email") ?? "") || undefined,
    address: String(formData.get("address") ?? "") || undefined,
  });
  if (!parsed.success) {
    backToStudent(String(formData.get("studentId") ?? ""), "?error=INVALID_INPUT");
  }

  const c = await createGuardian(ctx(tenant), {
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    phone: parsed.data.phone,
    email: parsed.data.email,
    address: parsed.data.address,
  });
  if (!c.ok) backToStudent(parsed.data.studentId, `?error=${c.error}`);

  const res = await linkGuardianToStudent(ctx(tenant), {
    studentId: parsed.data.studentId,
    guardianId: c.result.id,
    relation: parsed.data.relation,
  });
  backToStudent(
    parsed.data.studentId,
    res.ok ? "?ok=linked" : `?error=${res.error}`,
  );
}

export async function unlinkGuardianAction(formData: FormData) {
  const tenant = await requireSchoolPermission("guardian.manage");

  const linkId = String(formData.get("linkId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  if (!linkId || !studentId) backToStudent(studentId, "?error=INVALID_INPUT");

  const res = await unlinkGuardian(ctx(tenant), linkId);
  backToStudent(
    studentId,
    res.ok ? "?ok=unlinked" : `?error=${res.error}`,
  );
}
