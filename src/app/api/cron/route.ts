import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runDueJobs } from "@/lib/services/comm/queue";
import {
  registerCommHandlers,
  runPlatformAutomations,
  runSchoolAutomations,
} from "@/lib/services/comm/automations";
import { runMobileMoneyMaintenance } from "@/lib/services/payments/webhooks";
import { purgeExpiredData } from "@/lib/services/retention";
import { prisma } from "@/lib/db/prisma";

/**
 * Endpoint de traitement planifié : exécute la file de jobs et les
 * automatisations. Protégé par CRON_SECRET (Bearer ou x-cron-secret).
 * À appeler depuis un planificateur externe (cron, GitHub Actions, etc.).
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET non configuré" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  const alt = req.headers.get("x-cron-secret");
  // Comparaison en temps constant pour éviter un oracle temporel.
  const eq = (a: string | null, b: string) =>
    !!a &&
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b));
  if (!eq(auth, `Bearer ${secret}`) && !eq(alt, secret)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  registerCommHandlers();
  const jobs = await runDueJobs({ limit: 50 });
  // G3-B : reprise événements webhook, repost différés, polling de
  // secours, expiration — idempotent à chaque passage du cron.
  const mobileMoney = await runMobileMoneyMaintenance().catch(() => null);

  const scope = new URL(req.url).searchParams.get("scope") ?? "all";
  let platform: unknown = null;
  let schools = 0;
  if (scope === "all" || scope === "platform") {
    platform = await runPlatformAutomations();
  }
  if (scope === "all" || scope === "maintenance") {
    // Purge de rétention : jobs/livraisons/invitations expirés selon la config.
    const purged = await purgeExpiredData();
    platform = { ...(typeof platform === "object" && platform ? platform : {}), purged };
  }
  if (scope === "all" || scope === "schools") {
    const list = await prisma.school.findMany({
      where: { status: "ACTIVE" },
      select: { id: true },
    });
    for (const s of list) {
      await runSchoolAutomations(s.id).catch(() => null);
      schools++;
    }
  }

  return NextResponse.json({ ok: true, jobs, platform, schools, mobileMoney });
}

export const GET = handle;
export const POST = handle;
