"use server";

import { requireSchoolContext } from "@/lib/tenant/context";
import { markAllRead, markNotificationRead } from "@/lib/services/notifications";
import { revalidatePath } from "next/cache";

export async function markAllReadAction() {
  const t = await requireSchoolContext();
  await markAllRead(t.userId, t.schoolId);
  revalidatePath("/app/notifications");
}

export async function markReadAction(fd: FormData) {
  const t = await requireSchoolContext();
  const id = String(fd.get("id") ?? "");
  if (id) await markNotificationRead(t.userId, id, t.schoolId);
  revalidatePath("/app/notifications");
}
