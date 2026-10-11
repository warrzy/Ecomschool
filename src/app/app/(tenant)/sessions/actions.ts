"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { requireSchoolContext } from "@/lib/tenant/context";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import {
  moveSession,
  setSessionStatus,
  replaceSessionTeacher,
  upsertSessionContent,
  ensureSessionFromSchedule,
} from "@/lib/services/schedules";
import { saveSessionAttendance } from "@/lib/services/attendance";
import {
  sessionMoveSchema,
  sessionStatusSchema,
  contentUpsertSchema,
} from "@/lib/validations/schedules";

function back(id: string, params: string): never {
  redirect(`/app/sessions/${id}${params}` as never);
}

const pick = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return v === null ? undefined : String(v) || undefined;
};

const errMsg = (error: string) => {
  switch (error) {
    case "CONFLICT_CLASSROOM":
      return "Conflit classe";
    case "CONFLICT_TEACHER":
      return "Conflit enseignant";
    case "CONFLICT_ROOM":
      return "Conflit salle";
    default:
      return error;
  }
};

export async function openSessionAction(formData: FormData) {
  const tenant = await requireSchoolPermission("sessions.read");
  const scheduleId = String(formData.get("scheduleId") ?? "");
  const date = String(formData.get("date") ?? "");
  const res = await ensureSessionFromSchedule(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    scheduleId,
    date,
  );
  if (!res.ok) back(scheduleId, `?error=${res.error}`);
  redirect(`/app/sessions/${res.result.id}`);
}

export async function moveSessionAction(formData: FormData) {
  const tenant = await requireSchoolPermission("sessions.manage");
  const parsed = sessionMoveSchema.safeParse({
    id: formData.get("id"),
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
  });
  if (!parsed.success) back(String(formData.get("id") ?? ""), "?error=INVALID_INPUT");

  const res = await moveSession(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    parsed.data.id,
    { date: parsed.data.date, startMin: parsed.data.startMin, endMin: parsed.data.endMin },
  );
  back(
    parsed.data.id,
    res.ok ? "?ok=moved" : `?error=${encodeURIComponent(errMsg(res.error))}`,
  );
}

export async function setSessionStatusAction(formData: FormData) {
  const tenant = await requireSchoolPermission("sessions.manage");
  const parsed = sessionStatusSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
    cancellationReason: pick(formData, "cancellationReason"),
  });
  if (!parsed.success) back(String(formData.get("id") ?? ""), "?error=INVALID_INPUT");

  const res = await setSessionStatus(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    parsed.data.id,
    parsed.data.status,
    parsed.data.cancellationReason,
  );
  back(parsed.data.id, res.ok ? "?ok=status" : `?error=${res.error}`);
}

export async function replaceTeacherAction(formData: FormData) {
  const tenant = await requireSchoolPermission("sessions.manage");
  const id = String(formData.get("id") ?? "");
  const teacherId = String(formData.get("teacherId") ?? "");
  if (!id || !teacherId) back(id, "?error=INVALID_INPUT");

  const res = await replaceSessionTeacher(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
    teacherId,
  );
  back(id, res.ok ? "?ok=teacher" : `?error=${encodeURIComponent(errMsg(res.error))}`);
}

/** Cahier de textes : admin OU enseignant assigné à la séance. */
export async function upsertContentAction(formData: FormData) {
  const tenant = await requireSchoolContext();
  const sessionId = String(formData.get("sessionId") ?? "");

  const canManageAll = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "sessions.manage",
  });
  if (!canManageAll) {
    const { teacherIdForUser } = await import("@/lib/services/attendance");
    const tid = await teacherIdForUser({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
    });
    if (!tid) back(sessionId, "?error=FORBIDDEN");
    const { prisma } = await import("@/lib/db/prisma");
    const session = await prisma.courseSession.findFirst({
      where: {
        id: sessionId,
        schoolId: tenant.schoolId,
        teacherId: tid,
      },
      select: { id: true },
    });
    if (!session) back(sessionId, "?error=FORBIDDEN");
  }

  const parsed = contentUpsertSchema.safeParse({
    sessionId: formData.get("sessionId"),
    theme: pick(formData, "theme"),
    chapter: pick(formData, "chapter"),
    objective: pick(formData, "objective"),
    content: pick(formData, "content"),
    homework: pick(formData, "homework"),
    notes: pick(formData, "notes"),
  });
  if (!parsed.success) back(sessionId, "?error=INVALID_INPUT");

  const res = await upsertSessionContent(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    parsed.data.sessionId,
    parsed.data,
  );
  back(sessionId, res.ok ? "?ok=content" : `?error=${res.error}`);
}

/** Appel par séance : admin OU enseignant de la séance. */
export async function saveSessionAttendanceAction(formData: FormData) {
  const tenant = await requireSchoolContext();
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) redirect("/app/attendance?error=INVALID_INPUT");

  let forTeacherId: string | undefined;
  const canManageAll = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "attendance.manage",
  });
  if (!canManageAll) {
    const { teacherIdForUser } = await import("@/lib/services/attendance");
    const tid = await teacherIdForUser({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
    });
    if (!tid) back(sessionId, "?error=FORBIDDEN");
    forTeacherId = tid;
  }

  const timeToMin = (v: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
  };

  const marks = [...formData.keys()]
    .filter((k) => k.startsWith("status_"))
    .map((k) => {
      const studentId = k.slice("status_".length);
      const status = String(formData.get(k) ?? "");
      if (!["PRESENT", "ABSENT", "LATE", "EXCUSED"].includes(status)) {
        return null;
      }
      const arrival = String(formData.get(`arrival_${studentId}`) ?? "");
      return {
        studentId,
        status: status as "PRESENT" | "ABSENT" | "LATE" | "EXCUSED",
        arrivalMin: arrival ? timeToMin(arrival) : undefined,
        reason: String(formData.get(`reason_${studentId}`) ?? "") || undefined,
      };
    })
    .filter((m) => m !== null);

  const res = await saveSessionAttendance(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    sessionId,
    marks,
    forTeacherId,
  );
  back(sessionId, res.ok ? "?ok=attendance" : `?error=${res.error}`);
}
