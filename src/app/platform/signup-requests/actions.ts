"use server";

import { redirect } from "next/navigation";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { reviewSignupRequest } from "@/lib/services/platform/signup-requests";

const back = (path: string): never => redirect(path as never);

export async function reviewSignupRequestAction(formData: FormData) {
  const ctx = await requirePlatformPermission("platform.schools.manage");
  const action = String(formData.get("action") ?? "") as
    | "CONTACTED"
    | "APPROVED"
    | "REJECTED";
  if (!["CONTACTED", "APPROVED", "REJECTED"].includes(action)) {
    return back("/platform/signup-requests?error=INVALID_INPUT");
  }
  const res = await reviewSignupRequest(ctx.userId, {
    id: String(formData.get("id") ?? ""),
    action,
    note: String(formData.get("note") ?? "") || undefined,
  });
  back(
    res.ok
      ? `/platform/signup-requests?ok=${action.toLowerCase()}`
      : `/platform/signup-requests?error=${res.error}`,
  );
}
