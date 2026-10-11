import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import type { RoomType } from "@prisma/client";

export type RoomsError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CODE_TAKEN"
  | "CREATE_FAILED"
  | "UPDATE_FAILED";

export type RoomsResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: RoomsError };

type SchoolCtx = { userId: string; schoolId: string };

export async function listRooms(
  ctx: SchoolCtx,
  filters: {
    status?: "ACTIVE" | "ARCHIVED";
    q?: string;
    type?: RoomType;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const q = filters.q?.trim();

  const where = {
    schoolId: ctx.schoolId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" as const } },
            { name: { contains: q, mode: "insensitive" as const } },
            { building: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.room.count({ where }),
    prisma.room.findMany({
      where,
      orderBy: [{ code: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        code: true,
        name: true,
        capacity: true,
        building: true,
        floor: true,
        type: true,
        status: true,
      },
    }),
  ]);

  return { items, total, page, pageSize };
}

export async function getRoom(ctx: SchoolCtx, roomId: string) {
  return prisma.room.findFirst({
    where: { id: roomId, schoolId: ctx.schoolId },
    select: {
      id: true,
      code: true,
      name: true,
      capacity: true,
      building: true,
      floor: true,
      type: true,
      status: true,
    },
  });
}

type RoomInput = {
  code: string;
  name: string;
  capacity?: number | null;
  building?: string;
  floor?: string;
  type?: RoomType;
};

export async function createRoom(
  ctx: SchoolCtx,
  input: RoomInput,
): Promise<RoomsResult<{ id: string }>> {
  const dup = await prisma.room.findFirst({
    where: { schoolId: ctx.schoolId, code: input.code.trim() },
    select: { id: true },
  });
  if (dup) return { ok: false, error: "CODE_TAKEN" };

  try {
    const room = await prisma.room.create({
      data: {
        schoolId: ctx.schoolId,
        code: input.code.trim(),
        name: input.name.trim(),
        capacity: input.capacity ?? null,
        building: input.building?.trim() || null,
        floor: input.floor?.trim() || null,
        type: input.type ?? "CLASSROOM",
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "room.create",
      entity: "Room",
      entityId: room.id,
      metadata: { code: input.code.trim() },
    });

    return { ok: true, result: { id: room.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function updateRoom(
  ctx: SchoolCtx,
  roomId: string,
  input: Partial<RoomInput> & { status?: "ACTIVE" | "ARCHIVED" },
): Promise<RoomsResult> {
  const room = await prisma.room.findFirst({
    where: { id: roomId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!room) return { ok: false, error: "NOT_FOUND" };

  if (input.code) {
    const dup = await prisma.room.findFirst({
      where: {
        schoolId: ctx.schoolId,
        code: input.code.trim(),
        id: { not: roomId },
      },
      select: { id: true },
    });
    if (dup) return { ok: false, error: "CODE_TAKEN" };
  }

  try {
    await prisma.room.update({
      where: { id: roomId },
      data: {
        ...(input.code !== undefined ? { code: input.code.trim() } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.building !== undefined
          ? { building: input.building.trim() || null }
          : {}),
        ...(input.floor !== undefined
          ? { floor: input.floor.trim() || null }
          : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "room.update",
      entity: "Room",
      entityId: roomId,
      metadata: { fields: Object.keys(input) },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}
