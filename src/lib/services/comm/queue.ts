import { prisma } from "@/lib/db/prisma";
import type { JobStatus } from "@prisma/client";

/**
 * File d'attente persistante sur PostgreSQL :
 * jobs idempotents via `dedupKey`, retries à délai progressif (2^n minutes),
 * récupération des jobs RUNNING bloqués (interruption) et historique Job.
 * Aucune dépendance externe — adapté à un déploiement Next.js simple.
 */

const STALE_RUNNING_MS = 10 * 60 * 1000;

export async function enqueueJob(input: {
  type: string;
  payload: Record<string, unknown>;
  schoolId?: string | null;
  runAt?: Date;
  dedupKey?: string;
  maxAttempts?: number;
}) {
  try {
    const job = await prisma.job.create({
      data: {
        type: input.type,
        payload: input.payload as never,
        schoolId: input.schoolId ?? null,
        runAt: input.runAt ?? new Date(),
        dedupKey: input.dedupKey ?? null,
        maxAttempts: input.maxAttempts ?? 5,
      },
      select: { id: true },
    });
    return { ok: true as const, jobId: job.id, deduplicated: false };
  } catch (e) {
    // Clé de déduplication déjà présente → job unique.
    if ((e as { code?: string })?.code === "P2002") {
      return { ok: true as const, jobId: null, deduplicated: true };
    }
    return { ok: false as const, error: "ENQUEUE_FAILED" };
  }
}

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

function backoffMs(attempts: number) {
  return Math.min(60, 2 ** attempts) * 60 * 1000; // 2,4,8,…,60 min
}

/**
 * Exécute les jobs dus (PENDING, runAt passé) et récupère les RUNNING bloqués.
 * Idempotent : un job P2002-dédupliqué n'est jamais rejoué.
 */
export async function runDueJobs(opts: { limit?: number } = {}) {
  // Reprise après interruption : RUNNING stale → PENDING.
  await prisma.job.updateMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - STALE_RUNNING_MS) },
    },
    data: { status: "PENDING", lastError: "INTERRUPTED" },
  });

  const due = await prisma.job.findMany({
    where: { status: "PENDING", runAt: { lte: new Date() } },
    orderBy: { runAt: "asc" },
    take: opts.limit ?? 25,
  });

  let done = 0;
  let failed = 0;
  for (const job of due) {
    // Verrou optimiste : un seul worker prend le job.
    const claimed = await prisma.job.updateMany({
      where: { id: job.id, status: "PENDING" },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;

    const handler = handlers.get(job.type);
    try {
      if (!handler) throw new Error(`NO_HANDLER:${job.type}`);
      await handler((job.payload ?? {}) as Record<string, unknown>);
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "DONE", finishedAt: new Date() },
      });
      done++;
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      const dead = job.attempts + 1 >= job.maxAttempts;
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: dead ? "DEAD" : "PENDING",
          lastError: msg.slice(0, 500),
          runAt: new Date(Date.now() + backoffMs(job.attempts + 1)),
          ...(dead ? { finishedAt: new Date() } : {}),
        },
      });
    }
  }
  return { processed: due.length, done, failed };
}

export async function jobStats() {
  const rows = await prisma.job.groupBy({ by: ["status"], _count: true });
  const by = Object.fromEntries(rows.map((r) => [r.status, r._count]));
  return {
    pending: by.PENDING ?? 0,
    running: by.RUNNING ?? 0,
    done: by.DONE ?? 0,
    dead: by.DEAD ?? 0,
  };
}

export async function listJobs(opts: { status?: JobStatus; take?: number } = {}) {
  return prisma.job.findMany({
    where: opts.status ? { status: opts.status } : {},
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 50,
    select: {
      id: true,
      type: true,
      status: true,
      attempts: true,
      lastError: true,
      runAt: true,
      createdAt: true,
      finishedAt: true,
      schoolId: true,
      dedupKey: true,
    },
  });
}
