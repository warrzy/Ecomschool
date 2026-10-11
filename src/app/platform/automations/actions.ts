"use server";

import { requirePlatformPermission } from "@/lib/permissions/guard";
import { runDueJobs, enqueueJob } from "@/lib/services/comm/queue";
import { registerCommHandlers } from "@/lib/services/comm/automations";
import { revalidatePath } from "next/cache";

export async function runJobsAction() {
  await requirePlatformPermission("platform.monitoring.read");
  registerCommHandlers();
  await runDueJobs({ limit: 50 });
  revalidatePath("/platform/automations");
}

export async function enqueueAutomationAction() {
  await requirePlatformPermission("platform.monitoring.read");
  const today = new Date().toISOString().slice(0, 10);
  await enqueueJob({
    type: "automation.platform",
    payload: {},
    dedupKey: `automation.platform:${today}`,
  });
  revalidatePath("/platform/automations");
}
