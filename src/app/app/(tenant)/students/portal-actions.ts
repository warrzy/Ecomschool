"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  inviteGuardianAccount,
  inviteStudentAccount,
  resendInvite,
  setPortalAccountStatus,
} from "@/lib/services/portal/accounts";

function back(studentId: string, params: string): never {
  redirect(`/app/students/${studentId}?${params}` as never);
}

/** Lien d'invitation renvoyé dans l'URL (à transmettre par l'admin — aucun email/SMS envoyé). */
export async function inviteStudentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("portal.manage");
  const studentId = String(formData.get("studentId") ?? "");
  const res = await inviteStudentAccount(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    { studentId, email: String(formData.get("email") ?? "") || undefined },
  );
  if (!res.ok) back(studentId, `error=${res.error}`);
  back(studentId, `invite=${encodeURIComponent(`/invite/${res.result.token}`)}`);
}

export async function inviteGuardianAction(formData: FormData) {
  const tenant = await requireSchoolPermission("portal.manage");
  const studentId = String(formData.get("studentId") ?? "");
  const res = await inviteGuardianAccount(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    {
      guardianId: String(formData.get("guardianId") ?? ""),
      email: String(formData.get("email") ?? "") || undefined,
    },
  );
  if (!res.ok) back(studentId, `error=${res.error}`);
  back(studentId, `invite=${encodeURIComponent(`/invite/${res.result.token}`)}`);
}

export async function resendInviteAction(formData: FormData) {
  const tenant = await requireSchoolPermission("portal.manage");
  const studentId = String(formData.get("studentId") ?? "");
  const res = await resendInvite(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    String(formData.get("userId") ?? ""),
  );
  if (!res.ok) back(studentId, `error=${res.error}`);
  back(studentId, `invite=${encodeURIComponent(`/invite/${res.result.token}`)}`);
}

export async function setPortalAccessAction(formData: FormData) {
  const tenant = await requireSchoolPermission("portal.manage");
  const studentId = String(formData.get("studentId") ?? "");
  const status = formData.get("status") === "ACTIVE" ? "ACTIVE" : "DISABLED";
  const res = await setPortalAccountStatus(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    { userId: String(formData.get("userId") ?? ""), status },
  );
  back(studentId, res.ok ? "ok=access" : `error=${res.error}`);
}
