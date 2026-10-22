"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  replyParentReenrollment,
  submitParentReenrollment,
  uploadParentReenrollmentDoc,
} from "@/lib/services/reenrollment";

const back = (path: string): never => redirect(path as never);

export async function submitReenrollAction(formData: FormData) {
  const t = await requireSchoolPermission("portal.parent");
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const campaignId = String(formData.get("campaignId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const kind = String(formData.get("kind") ?? "REENROLL") === "DEPARTURE" ? "DEPARTURE" : "REENROLL";
  if (!campaignId || !studentId) return back("/parent?tab=reinscription&error=INVALID_INPUT");
  const res = await submitParentReenrollment(ctx, {
    campaignId,
    studentId,
    kind,
    desiredLevelId: String(formData.get("desiredLevelId") ?? "") || undefined,
    contactUpdate: {
      phone: String(formData.get("phone") ?? "") || undefined,
      email: String(formData.get("email") ?? "") || undefined,
      address: String(formData.get("address") ?? "") || undefined,
    },
    note: String(formData.get("note") ?? "") || undefined,
  });
  return back(
    res.ok
      ? "/parent?tab=reinscription&ok=submitted"
      : `/parent?tab=reinscription&error=${res.error}`,
  );
}

export async function replyReenrollAction(formData: FormData) {
  const t = await requireSchoolPermission("portal.parent");
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const requestId = String(formData.get("requestId") ?? "");
  const body = String(formData.get("reply") ?? "");
  if (!requestId || !body.trim()) return back("/parent?tab=reinscription&error=INVALID_INPUT");
  const res = await replyParentReenrollment(ctx, requestId, body);
  return back(
    res.ok
      ? "/parent?tab=reinscription&ok=reply"
      : `/parent?tab=reinscription&error=${res.error}`,
  );
}

export async function uploadReenrollDocAction(formData: FormData) {
  const t = await requireSchoolPermission("portal.parent");
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const requestId = String(formData.get("requestId") ?? "");
  const docKey = String(formData.get("docKey") ?? "");
  const file = formData.get("file");
  if (!requestId || !docKey || !(file instanceof File) || file.size === 0) {
    return back("/parent?tab=reinscription&error=INVALID_INPUT");
  }
  const res = await uploadParentReenrollmentDoc(ctx, requestId, {
    buffer: Buffer.from(await file.arrayBuffer()),
    originalName: file.name,
    docKey,
    ip: String(formData.get("ip") ?? "") || undefined,
  });
  return back(
    res.ok
      ? "/parent?tab=reinscription&ok=uploaded"
      : `/parent?tab=reinscription&error=${res.error}`,
  );
}
