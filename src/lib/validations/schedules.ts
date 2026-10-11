import { z } from "zod";

export const weekdayEnum = z.enum([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

const timeToMin = (v: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
};

export const scheduleCreateSchema = z.object({
  academicYearId: z.string().min(1),
  classroomId: z.string().min(1),
  teacherId: z.string().min(1),
  subjectId: z.string().optional(),
  roomId: z.string().optional(),
  weekday: weekdayEnum,
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  validFrom: z.string().min(1),
  validUntil: z.string().optional(),
}).transform((v) => ({
  ...v,
  startMin: timeToMin(v.startTime),
  endMin: timeToMin(v.endTime),
}));

export const scheduleUpdateSchema = z.object({
  id: z.string().min(1),
  weekday: weekdayEnum.optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  teacherId: z.string().optional(),
  roomId: z.string().optional(),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
}).transform((v) => ({
  ...v,
  startMin: v.startTime ? timeToMin(v.startTime) : undefined,
  endMin: v.endTime ? timeToMin(v.endTime) : undefined,
}));

export const sessionCreateSchema = z.object({
  classroomId: z.string().min(1),
  teacherId: z.string().min(1),
  academicYearId: z.string().optional(),
  subjectId: z.string().optional(),
  roomId: z.string().optional(),
  date: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
}).transform((v) => ({
  ...v,
  startMin: timeToMin(v.startTime),
  endMin: timeToMin(v.endTime),
}));

export const sessionMoveSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
}).transform((v) => ({
  ...v,
  startMin: timeToMin(v.startTime),
  endMin: timeToMin(v.endTime),
}));

export const sessionStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["PLANNED", "DONE", "CANCELLED", "POSTPONED"]),
  cancellationReason: z.string().trim().max(500).optional(),
});

export const contentUpsertSchema = z.object({
  sessionId: z.string().min(1),
  theme: z.string().trim().max(200).optional(),
  chapter: z.string().trim().max(200).optional(),
  objective: z.string().trim().max(1000).optional(),
  content: z.string().trim().max(8000).optional(),
  homework: z.string().trim().max(4000).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export const dailyAttendanceSchema = z.object({
  classroomId: z.string().min(1),
  date: z.string().min(1),
  // marques encodées : "studentId|status|expectedMin|arrivalMin|reason"
  marks: z.array(z.string()).default([]),
});

export const attendanceRecordSchema = z.object({
  studentId: z.string().min(1),
  date: z.string().min(1),
  status: z.enum(["ABSENT", "LATE"]),
  sessionId: z.string().optional(),
  expectedTime: z.string().optional(),
  arrivalTime: z.string().optional(),
  reason: z.string().trim().max(500).optional(),
}).transform((v) => ({
  ...v,
  expectedMin: v.expectedTime ? timeToMin(v.expectedTime) : undefined,
  arrivalMin: v.arrivalTime ? timeToMin(v.arrivalTime) : undefined,
}));

export const justifySchema = z.object({
  id: z.string().min(1),
  justification: z.string().trim().min(1).max(1000),
});

export function parseMark(raw: string):
  | {
      studentId: string;
      status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
      expectedMin?: number;
      arrivalMin?: number;
      reason?: string;
    }
  | null {
  const [studentId, status, expected, arrival, reason] = raw.split("|");
  if (!studentId) return null;
  if (!["PRESENT", "ABSENT", "LATE", "EXCUSED"].includes(status ?? "")) {
    return null;
  }
  const expectedMin = expected ? timeToMin(expected) : undefined;
  const arrivalMin = arrival ? timeToMin(arrival) : undefined;
  return {
    studentId,
    status: status as "PRESENT" | "ABSENT" | "LATE" | "EXCUSED",
    expectedMin: Number.isNaN(expectedMin) ? undefined : expectedMin,
    arrivalMin: Number.isNaN(arrivalMin) ? undefined : arrivalMin,
    reason: reason || undefined,
  };
}
