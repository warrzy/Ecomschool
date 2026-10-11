"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  createSchedule,
  updateSchedule,
  createSession,
} from "@/lib/services/schedules";
import {
  scheduleCreateSchema,
  scheduleUpdateSchema,
  sessionCreateSchema,
} from "@/lib/validations/schedules";

function back(params: string): never {
  redirect(`/app/schedules${params}` as never);
}

const pick = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return v === null ? undefined : String(v) || undefined;
};

const errMsg = (error: string) => {
  switch (error) {
    case "CONFLICT_CLASSROOM":
      return "Conflit : la classe a déjà un cours sur ce créneau";
    case "CONFLICT_TEACHER":
      return "Conflit : l'enseignant a déjà un cours sur ce créneau";
    case "CONFLICT_ROOM":
      return "Conflit : la salle est déjà occupée sur ce créneau";
    case "CONFLICT":
      return "Conflit concurrent détecté, réessayez";
    default:
      return error;
  }
};

export async function createScheduleAction(formData: FormData) {
  const tenant = await requireSchoolPermission("schedules.manage");

  const parsed = scheduleCreateSchema.safeParse({
    academicYearId: formData.get("academicYearId"),
    classroomId: formData.get("classroomId"),
    teacherId: formData.get("teacherId"),
    subjectId: pick(formData, "subjectId"),
    roomId: pick(formData, "roomId"),
    weekday: formData.get("weekday"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    validFrom: formData.get("validFrom"),
    validUntil: pick(formData, "validUntil"),
  });
  if (!parsed.success || Number.isNaN(parsed.data.startMin) || Number.isNaN(parsed.data.endMin)) {
    back("?error=INVALID_INPUT");
  }

  const { startTime, endTime, ...input } = parsed.data;
  void startTime;
  void endTime;
  const res = await createSchedule(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    input,
  );
  back(res.ok ? "?ok=created" : `?error=${encodeURIComponent(errMsg(res.error))}`);
}

export async function updateScheduleAction(formData: FormData) {
  const tenant = await requireSchoolPermission("schedules.manage");

  const parsed = scheduleUpdateSchema.safeParse({
    id: formData.get("id"),
    weekday: pick(formData, "weekday"),
    startTime: pick(formData, "startTime"),
    endTime: pick(formData, "endTime"),
    teacherId: pick(formData, "teacherId"),
    roomId: pick(formData, "roomId"),
    validFrom: pick(formData, "validFrom"),
    validUntil: pick(formData, "validUntil"),
    status: pick(formData, "status"),
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

  const { id, startTime, endTime, ...input } = parsed.data;
  void startTime;
  void endTime;
  const res = await updateSchedule(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
    input,
  );
  back(res.ok ? "?ok=updated" : `?error=${encodeURIComponent(errMsg(res.error))}`);
}

export async function createSessionAction(formData: FormData) {
  const tenant = await requireSchoolPermission("sessions.manage");

  const parsed = sessionCreateSchema.safeParse({
    classroomId: formData.get("classroomId"),
    teacherId: formData.get("teacherId"),
    academicYearId: pick(formData, "academicYearId"),
    subjectId: pick(formData, "subjectId"),
    roomId: pick(formData, "roomId"),
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
  });
  if (!parsed.success || Number.isNaN(parsed.data.startMin)) {
    back("?error=INVALID_INPUT");
  }

  const { startTime, endTime, ...input } = parsed.data;
  void startTime;
  void endTime;
  const res = await createSession(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    input,
  );
  back(res.ok ? "?ok=session" : `?error=${encodeURIComponent(errMsg(res.error))}`);
}
