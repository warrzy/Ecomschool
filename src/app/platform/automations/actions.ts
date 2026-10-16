"use server";

import { requirePlatformPermission } from "@/lib/permissions/guard";
import { runDueJobs, enqueueJob } from "@/lib/services/comm/queue";
import { registerCommHandlers } from "@/lib/services/comm/automations";
import { purgeExpiredData } from "@/lib/services/retention";
import { revalidatePath } from "next/cache";

export async function runJobsAction() {
  await requirePlatformPermission("platform.monitoring.manage");
  registerCommHandlers();
  await runDueJobs({ limit: 50 });
  revalidatePath("/platform/automations");
}

export async function enqueueAutomationAction() {
  await requirePlatformPermission("platform.monitoring.manage");
  const today = new Date().toISOString().slice(0, 10);
  await enqueueJob({
    type: "automation.platform",
    payload: {},
    dedupKey: `automation.platform:${today}`,
  });
  revalidatePath("/platform/automations");
}

/** Purge manuelle de rétention (jobs, livraisons, invitations expirées). */
export async function runRetentionPurgeAction() {
  await requirePlatformPermission("platform.monitoring.manage");
  await purgeExpiredData();
  revalidatePath("/platform/automations");
}
