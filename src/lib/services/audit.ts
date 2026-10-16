import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

export async function logAudit(input: {
  actorId?: string | null;
  schoolId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  /** Transaction facultative : l'audit suit l'atomicité de l'opération. */
  tx?: Prisma.TransactionClient;
}) {
  try {
    await (input.tx ?? prisma).auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        schoolId: input.schoolId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        metadata: input.metadata,
      },
      select: { id: true },
    });
  } catch (e) {
    // L'audit ne doit jamais bloquer une opération métier, mais l'échec
    // reste traçable (stdout → supervision).
    console.error("AUDIT_LOG_FAILED", input.action, input.entity, e);
  }
}

export async function listAuditLogs(opts: {
  schoolId?: string | null;
  entity?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));

  const where = {
    ...(opts.schoolId !== undefined ? { schoolId: opts.schoolId } : {}),
    ...(opts.entity ? { entity: opts.entity } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        metadata: true,
        createdAt: true,
        actor: { select: { email: true } },
        school: { select: { name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}
