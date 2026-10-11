import { prisma } from "@/lib/db/prisma";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Mesures réelles de supervision — aucune valeur statique. */
export async function platformMonitoring() {
  const dbStart = Date.now();
  let dbOk = false;
  let dbMs = 0;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
    dbMs = Date.now() - dbStart;
  } catch {
    dbMs = Date.now() - dbStart;
  }

  const [
    schools,
    activeSchools,
    users,
    students,
    enrollments,
    payments,
    invoices,
    auditRecent,
    subscriptions,
  ] = await Promise.all([
    prisma.school.count(),
    prisma.school.count({ where: { status: "ACTIVE" } }),
    prisma.user.count(),
    prisma.student.count(),
    prisma.enrollment.count({ where: { status: "ENROLLED" } }),
    prisma.payment.count({ where: { status: "VALIDATED" } }),
    prisma.platformInvoice.count(),
    prisma.auditLog.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 3600000) } },
    }),
    prisma.schoolSubscription.groupBy({
      by: ["status"],
      _count: true,
    }),
  ]);

  let migrations: { name: string; finishedAt: Date | null }[] = [];
  try {
    migrations = await prisma.$queryRawUnsafe<
      { migration_name: string; finished_at: Date | null }[]
    >(
      `SELECT migration_name AS name, finished_at AS "finishedAt" FROM "_prisma_migrations" ORDER BY finished_at DESC NULLS LAST LIMIT 12`,
    ).then((rows) =>
      rows.map((r) => ({ name: r.migration_name, finishedAt: r.finished_at })),
    );
  } catch {
    migrations = [];
  }

  let version = "0.0.0";
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    version = pkg.version ?? version;
  } catch {
    // ignoré
  }

  const recentErrors = await prisma.auditLog.findMany({
    where: { action: { contains: "error", mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { action: true, entity: true, createdAt: true, schoolId: true },
  });

  return {
    db: { ok: dbOk, latencyMs: dbMs },
    app: { version, nodeUptimeSec: Math.floor(process.uptime()) },
    usage: { schools, activeSchools, users, students, enrollments, payments, invoices },
    auditLast24h: auditRecent,
    subscriptions: Object.fromEntries(subscriptions.map((s) => [s.status, s._count])),
    migrations,
    recentErrors,
  };
}
