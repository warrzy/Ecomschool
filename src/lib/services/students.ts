import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { studentRowSchema } from "@/lib/validations/students";

export type StudentsError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "MATRICULE_TAKEN"
  | "CREATE_FAILED"
  | "UPDATE_FAILED";

export type StudentsResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: StudentsError };

type SchoolCtx = { userId: string; schoolId: string };

const studentSelect = {
  id: true,
  matricule: true,
  firstName: true,
  lastName: true,
  sex: true,
  birthDate: true,
  birthPlace: true,
  photoUrl: true,
  address: true,
  phone: true,
  email: true,
  status: true,
  createdAt: true,
} as const;

export async function listStudents(
  ctx: SchoolCtx,
  filters: {
    status?: "ACTIVE" | "ARCHIVED";
    q?: string;
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
    ...(q
      ? {
          OR: [
            { matricule: { contains: q, mode: "insensitive" as const } },
            { firstName: { contains: q, mode: "insensitive" as const } },
            { lastName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: studentSelect,
    }),
  ]);

  return { items, total, page, pageSize };
}

export async function getStudent(ctx: SchoolCtx, studentId: string) {
  return prisma.student.findFirst({
    where: { id: studentId, schoolId: ctx.schoolId },
    select: studentSelect,
  });
}

type StudentInput = {
  matricule: string;
  firstName: string;
  lastName: string;
  sex?: "MALE" | "FEMALE";
  birthDate?: string;
  birthPlace?: string;
  photoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
};

function toStudentData(ctx: SchoolCtx, input: StudentInput) {
  const birthDate = input.birthDate ? new Date(input.birthDate) : null;
  return {
    schoolId: ctx.schoolId,
    matricule: input.matricule.trim(),
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    sex: input.sex ?? null,
    birthDate:
      birthDate && !Number.isNaN(birthDate.getTime()) ? birthDate : null,
    birthPlace: input.birthPlace?.trim() || null,
    photoUrl: input.photoUrl?.trim() || null,
    address: input.address?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim().toLowerCase() || null,
  };
}

export async function createStudent(
  ctx: SchoolCtx,
  input: StudentInput,
): Promise<StudentsResult<{ id: string }>> {
  const existing = await prisma.student.findFirst({
    where: { schoolId: ctx.schoolId, matricule: input.matricule.trim() },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "MATRICULE_TAKEN" };

  try {
    const student = await prisma.student.create({
      data: toStudentData(ctx, input),
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "student.create",
      entity: "Student",
      entityId: student.id,
      metadata: { matricule: input.matricule.trim() },
    });

    return { ok: true, result: { id: student.id } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function updateStudent(
  ctx: SchoolCtx,
  studentId: string,
  input: Partial<StudentInput> & { status?: "ACTIVE" | "ARCHIVED" },
): Promise<StudentsResult> {
  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!student) return { ok: false, error: "NOT_FOUND" };

  if (input.matricule) {
    const dup = await prisma.student.findFirst({
      where: {
        schoolId: ctx.schoolId,
        matricule: input.matricule.trim(),
        id: { not: studentId },
      },
      select: { id: true },
    });
    if (dup) return { ok: false, error: "MATRICULE_TAKEN" };
  }

  try {
    await prisma.student.update({
      where: { id: studentId },
      data: {
        ...(input.matricule !== undefined
          ? { matricule: input.matricule.trim() }
          : {}),
        ...(input.firstName !== undefined
          ? { firstName: input.firstName.trim() }
          : {}),
        ...(input.lastName !== undefined
          ? { lastName: input.lastName.trim() }
          : {}),
        ...(input.sex !== undefined ? { sex: input.sex } : {}),
        ...(input.birthDate !== undefined
          ? {
              birthDate: input.birthDate
                ? new Date(input.birthDate)
                : null,
            }
          : {}),
        ...(input.birthPlace !== undefined
          ? { birthPlace: input.birthPlace.trim() || null }
          : {}),
        ...(input.photoUrl !== undefined
          ? { photoUrl: input.photoUrl.trim() || null }
          : {}),
        ...(input.address !== undefined
          ? { address: input.address.trim() || null }
          : {}),
        ...(input.phone !== undefined ? { phone: input.phone.trim() || null } : {}),
        ...(input.email !== undefined
          ? { email: input.email.trim().toLowerCase() || null }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      select: { id: true },
    });

    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "student.update",
      entity: "Student",
      entityId: studentId,
      metadata: { fields: Object.keys(input) },
    });

    return { ok: true, result: undefined };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

// ---------- CSV ----------

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === "," || ch === ";") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export type ImportReport = {
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: { line: number; reason: string }[];
};

// Colonnes attendues :
// matricule;nom;prenom;sexe(M|F);dateNaissance(YYYY-MM-DD);lieuNaissance;telephone;email;adresse
export async function importStudentsCsv(
  ctx: SchoolCtx,
  csvText: string,
): Promise<StudentsResult<ImportReport>> {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return { ok: false, error: "INVALID_INPUT" };

  const firstCells = parseCsvLine(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = firstCells[0]?.includes("matricule");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const report: ImportReport = {
    total: dataLines.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < dataLines.length; i++) {
    const lineNo = i + (hasHeader ? 2 : 1);
    const cells = parseCsvLine(dataLines[i]);

    const parsed = studentRowSchema.safeParse({
      matricule: cells[0],
      lastName: cells[1],
      firstName: cells[2],
      sex: cells[3] || undefined,
      birthDate: cells[4] || undefined,
      birthPlace: cells[5] || undefined,
      phone: cells[6] || undefined,
      email: cells[7] || undefined,
      address: cells[8] || undefined,
    });

    if (!parsed.success) {
      report.failed++;
      report.errors.push({
        line: lineNo,
        reason: parsed.error.issues[0]?.message ?? "INVALID_INPUT",
      });
      continue;
    }

    const data = toStudentData(ctx, parsed.data);

    try {
      const existing = await prisma.student.findFirst({
        where: { schoolId: ctx.schoolId, matricule: data.matricule },
        select: { id: true },
      });
      if (existing) {
        await prisma.student.update({
          where: { id: existing.id },
          data: { ...data, schoolId: undefined },
          select: { id: true },
        });
        report.updated++;
      } else {
        await prisma.student.create({ data, select: { id: true } });
        report.created++;
      }
    } catch {
      report.failed++;
      report.errors.push({ line: lineNo, reason: "DB_ERROR" });
    }
  }

  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "student.import",
    entity: "Student",
    metadata: {
      total: report.total,
      created: report.created,
      updated: report.updated,
      failed: report.failed,
    },
  });

  return { ok: true, result: report };
}

export async function exportStudentsCsv(ctx: SchoolCtx): Promise<string> {
  const students = await prisma.student.findMany({
    where: { schoolId: ctx.schoolId },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: studentSelect,
  });

  const esc = (v: string | null | undefined) => {
    const s = v ?? "";
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header =
    "matricule;nom;prenom;sexe;dateNaissance;lieuNaissance;telephone;email;adresse;statut";
  const rows = students.map((s) =>
    [
      s.matricule,
      s.lastName,
      s.firstName,
      s.sex === "MALE" ? "M" : s.sex === "FEMALE" ? "F" : "",
      s.birthDate ? s.birthDate.toISOString().slice(0, 10) : "",
      s.birthPlace,
      s.phone,
      s.email,
      s.address,
      s.status,
    ]
      .map(esc)
      .join(";"),
  );

  return [header, ...rows].join("\n");
}
