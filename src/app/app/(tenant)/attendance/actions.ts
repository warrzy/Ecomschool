"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  saveDailyAttendance,
  addAttendanceRecord,
  justifyAttendance,
} from "@/lib/services/attendance";
import {
  dailyAttendanceSchema,
  attendanceRecordSchema,
  justifySchema,
} from "@/lib/validations/schedules";

function back(params: string): never {
  redirect(`/app/attendance${params}` as never);
}

export async function saveDailyAttendanceAction(formData: FormData) {
  const tenant = await requireSchoolPermission("attendance.manage");

  const parsed = dailyAttendanceSchema.safeParse({
    classroomId: formData.get("classroomId"),
    date: formData.get("date"),
    marks: [],
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

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
      const expected = String(formData.get(`expected_${studentId}`) ?? "");
      const arrival = String(formData.get(`arrival_${studentId}`) ?? "");
      return {
        studentId,
        status: status as "PRESENT" | "ABSENT" | "LATE" | "EXCUSED",
        expectedMin: expected ? timeToMin(expected) : undefined,
        arrivalMin: arrival ? timeToMin(arrival) : undefined,
        reason: String(formData.get(`reason_${studentId}`) ?? "") || undefined,
      };
    })
    .filter((m) => m !== null);

  const res = await saveDailyAttendance(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    parsed.data.classroomId,
    parsed.data.date,
    marks,
  );
  back(
    res.ok
      ? `?ok=saved&classroomId=${parsed.data.classroomId}&date=${parsed.data.date}`
      : "?error=SAVE_FAILED",
  );
}

export async function addAttendanceRecordAction(formData: FormData) {
  const tenant = await requireSchoolPermission("attendance.manage");

  const pick = (k: string) => {
    const v = formData.get(k);
    return v === null ? undefined : String(v) || undefined;
  };

  const parsed = attendanceRecordSchema.safeParse({
    studentId: formData.get("studentId"),
    date: formData.get("date"),
    status: formData.get("status"),
    sessionId: pick("sessionId"),
    expectedTime: pick("expectedTime"),
    arrivalTime: pick("arrivalTime"),
    reason: pick("reason"),
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

  const { expectedTime, arrivalTime, ...rest } = parsed.data;
  void expectedTime;
  void arrivalTime;
  const res = await addAttendanceRecord(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    rest,
  );
  back(res.ok ? "?ok=recorded" : `?error=${res.error}`);
}

export async function justifyAttendanceAction(formData: FormData) {
  const tenant = await requireSchoolPermission("attendance.justify");

  const parsed = justifySchema.safeParse({
    id: formData.get("id"),
    justification: formData.get("justification"),
  });
  if (!parsed.success) back("?error=INVALID_INPUT");

  const res = await justifyAttendance(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    parsed.data.id,
    parsed.data.justification,
  );
  back(res.ok ? "?ok=justified" : `?error=${res.error}`);
}
