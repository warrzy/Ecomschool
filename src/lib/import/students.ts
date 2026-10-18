/**
 * Import élèves : analyse (sans écriture) puis confirmation.
 * - Upsert par matricule via createStudent / updateStudent.
 * - Champ vide = valeur existante conservée ; `__EFFACER__` = effacement
 *   explicite des champs facultatifs.
 * - Colonne `classe` facultative : inscription via enrollStudent, dans
 *   l'année scolaire choisie explicitement dans l'interface.
 * - Chaque ligne (élève + inscription) est confirmée dans sa propre
 *   transaction — import partiel des lignes valides uniquement.
 */
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import {
  createStudent,
  updateStudent,
} from "@/lib/services/students";
import { enrollStudent } from "@/lib/services/enrollments";
import { generateStudentCharges } from "@/lib/services/finance/accounts";
import { checkLimit } from "@/lib/services/platform/modules";
import { studentRowSchema } from "@/lib/validations/students";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import type { ImportRawRow } from "./csv";
import { readXlsxRows } from "./xlsx";
import { parseCsvText } from "./csv";
import { canonical, sha256, signPreviewToken } from "./token";

export const ERASE_MARKER = "__EFFACER__";
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_STUDENT_ROWS = 2000;

export const STUDENT_TEMPLATE_HEADERS = [
  "matricule",
  "nom",
  "prenom",
  "sexe",
  "date_naissance",
  "lieu_naissance",
  "telephone",
  "email",
  "adresse",
  "classe",
] as const;

const HEADER_ALIASES: Record<string, readonly string[]> = {
  matricule: ["matricule"],
  lastName: ["nom", "last_name", "lastname", "nom_de_famille"],
  firstName: ["prenom", "first_name", "firstname"],
  sex: ["sexe", "sex"],
  birthDate: ["date_naissance", "datenaissance", "birth_date", "birthdate"],
  birthPlace: ["lieu_naissance", "lieunaissance", "birth_place", "birthplace"],
  phone: ["telephone", "téléphone", "phone", "tel"],
  email: ["email", "e-mail", "mail", "courriel"],
  address: ["adresse", "address"],
  classroom: ["classe", "classroom", "classe_nom", "class_name"],
};

const REQUIRED_FIELDS = ["matricule", "lastName", "firstName"] as const;
type StudentField =
  | "matricule"
  | "lastName"
  | "firstName"
  | "sex"
  | "birthDate"
  | "birthPlace"
  | "phone"
  | "email"
  | "address"
  | "classroom";

export interface ImportIssue {
  line: number;
  column: string | null;
  value: string | null;
  reason: string;
}

export interface FieldChange {
  field: string;
  from: string | null;
  to: string | null;
  /** true = effacement explicite demandé via __EFFACER__. */
  erase?: boolean;
}

export interface StudentPreviewRow {
  line: number;
  matricule: string;
  action: "create" | "update" | "unchanged" | "error";
  displayName: string;
  changes: FieldChange[];
  enrollment: { classroomName: string; action: "create" | "existing" } | null;
  errors: ImportIssue[];
}

export interface StudentsPreview {
  academicYearId: string;
  summary: {
    total: number;
    created: number;
    updated: number;
    unchanged: number;
    enrollments: number;
    erased: number;
    errors: number;
  };
  rows: StudentPreviewRow[];
  token: string;
  expiresAt: string;
}

export type ImportSource =
  | { kind: "csv"; text: string }
  | { kind: "xlsx"; buffer: ArrayBuffer };

type SchoolCtx = { userId: string; schoolId: string };

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s-]+/g, "_");
}

/** Associe l'en-tête du fichier aux champs connus ; erreurs structurelles. */
function mapHeader(
  headerCells: string[],
): { ok: true; indexOf: Map<StudentField, number> } | { ok: false; reason: string } {
  const indexOf = new Map<StudentField, number>();
  for (let i = 0; i < headerCells.length; i++) {
    const h = normalizeHeader(headerCells[i]);
    if (!h) continue;
    const field = (Object.keys(HEADER_ALIASES) as StudentField[]).find((f) =>
      HEADER_ALIASES[f].some(
        (a) => normalizeHeader(a) === h,
      ),
    );
    if (!field) {
      return { ok: false, reason: `Colonne inconnue : « ${headerCells[i]} »` };
    }
    if (indexOf.has(field)) {
      return { ok: false, reason: `Colonne dupliquée : « ${headerCells[i]} »` };
    }
    indexOf.set(field, i);
  }
  for (const f of REQUIRED_FIELDS) {
    if (!indexOf.has(f)) {
      const label = f === "lastName" ? "nom" : f === "firstName" ? "prenom" : f;
      return { ok: false, reason: `Colonne obligatoire absente : « ${label} »` };
    }
  }
  return { ok: true, indexOf };
}

const FIELD_LABELS: Record<string, string> = {
  matricule: "matricule",
  lastName: "nom",
  firstName: "prenom",
  sex: "sexe",
  birthDate: "date_naissance",
  birthPlace: "lieu_naissance",
  phone: "telephone",
  email: "email",
  address: "adresse",
  classroom: "classe",
};

interface ResolvedStudentRow {
  line: number;
  matricule: string;
  /** Valeurs effectives après résolution (vide = conserver, effacement = null). */
  input: {
    matricule: string;
    firstName: string;
    lastName: string;
    sex?: "MALE" | "FEMALE" | null;
    birthDate?: string | null;
    birthPlace?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
  };
  /** Champs explicitement effacés. */
  erased: string[];
  classroomName: string | null;
  issues: ImportIssue[];
}

function resolveRow(
  row: ImportRawRow,
  indexOf: Map<StudentField, number>,
  seen: Map<string, number>,
): ResolvedStudentRow {
  const issues: ImportIssue[] = [];
  const erased: string[] = [];
  const input: ResolvedStudentRow["input"] = {
    matricule: "",
    firstName: "",
    lastName: "",
  };
  let classroomName: string | null = null;

  const cell = (f: StudentField) => {
    const i = indexOf.get(f);
    return i == null ? "" : (row.cells[i] ?? "").trim();
  };

  for (const f of [
    "matricule",
    "lastName",
    "firstName",
    "sex",
    "birthDate",
    "birthPlace",
    "phone",
    "email",
    "address",
  ] as const) {
    const raw = cell(f);
    const label = FIELD_LABELS[f];
    if (raw.toUpperCase() === ERASE_MARKER) {
      if ((REQUIRED_FIELDS as readonly string[]).includes(f)) {
        issues.push({
          line: row.line,
          column: label,
          value: raw,
          reason: "Champ obligatoire : effacement interdit",
        });
      } else {
        erased.push(f);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (input as any)[f] = null;
      }
      continue;
    }
    if (raw === "") continue; // vide = conserver / null à la création
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (input as any)[f] = raw;
  }

  const cls = cell("classroom");
  if (cls) classroomName = cls;

  const mat = input.matricule.trim();
  if (!mat) {
    issues.push({
      line: row.line,
      column: "matricule",
      value: null,
      reason: "Matricule obligatoire",
    });
  } else {
    const firstLine = seen.get(mat.toUpperCase());
    if (firstLine != null) {
      issues.push({
        line: row.line,
        column: "matricule",
        value: mat,
        reason: `Matricule en double dans le fichier (déjà ligne ${firstLine})`,
      });
    } else {
      seen.set(mat.toUpperCase(), row.line);
    }
  }

  // Validation zod des valeurs fournies uniquement : sur une mise à jour,
  // un champ obligatoire vide signifie « conserver » (l'obligation est
  // revérifiée à l'analyse pour les créations).
  const zodInput = {
    matricule: mat,
    ...(input.lastName ? { lastName: input.lastName } : {}),
    ...(input.firstName ? { firstName: input.firstName } : {}),
    sex: input.sex === null ? undefined : input.sex,
    birthDate: input.birthDate === null ? undefined : input.birthDate || undefined,
    birthPlace: input.birthPlace === null ? undefined : input.birthPlace,
    phone: input.phone === null ? undefined : input.phone,
    email: input.email === null ? undefined : input.email,
    address: input.address === null ? undefined : input.address,
  };
  const parsed = studentRowSchema.partial().safeParse(zodInput);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      issues.push({
        line: row.line,
        column: FIELD_LABELS[key] ?? (key || null),
        value:
          key && input[key as keyof typeof input] != null
            ? String(input[key as keyof typeof input])
            : null,
        reason:
          issue.message === "Required" || issue.code === "too_small"
            ? "Valeur obligatoire manquante"
            : `Valeur invalide (${issue.message})`,
      });
    }
  } else {
    // Normalisation zod (sexe M/F → MALE/FEMALE…)
    if (input.sex !== null && parsed.data.sex) input.sex = parsed.data.sex;
    if (input.birthDate !== null && parsed.data.birthDate) {
      input.birthDate = parsed.data.birthDate;
    }
  }

  return { line: row.line, matricule: mat, input, erased, classroomName, issues };
}

async function rowsFromSource(
  source: ImportSource,
  maxRows: number,
): Promise<
  { ok: true; rows: ImportRawRow[] } | { ok: false; error: string }
> {
  const res =
    source.kind === "xlsx"
      ? await readXlsxRows(source.buffer, maxRows)
      : parseCsvText(source.text, maxRows);
  if (!res.ok) {
    const reason =
      res.error === "EMPTY"
        ? "Fichier vide"
        : res.error === "TOO_MANY_ROWS"
          ? `Trop de lignes (maximum ${maxRows})`
          : res.error === "FORMULA"
            ? "Les cellules contenant des formules sont refusées"
            : "Fichier CSV malformé (guillemets non fermés ?)";
    return { ok: false, error: reason };
  }
  return { ok: true, rows: res.rows };
}

interface Analysis {
  rows: StudentPreviewRow[];
  resolved: ResolvedStudentRow[];
  fingerprint: string;
  summary: StudentsPreview["summary"];
  globalError?: string;
  requiresEnrollmentPermission?: boolean;
}

async function analyze(
  ctx: SchoolCtx,
  source: ImportSource,
  academicYearId: string,
): Promise<Analysis> {
  const parsed = await rowsFromSource(source, MAX_STUDENT_ROWS);
  if (!parsed.ok) {
    return {
      rows: [],
      resolved: [],
      fingerprint: "",
      summary: emptySummary(),
      globalError: parsed.error,
    };
  }

  const [headerRow, ...dataRows] = parsed.rows;
  const mapped = mapHeader(headerRow.cells);
  if (!mapped.ok) {
    return {
      rows: [],
      resolved: [],
      fingerprint: "",
      summary: emptySummary(),
      globalError: mapped.reason,
    };
  }
  const indexOf = mapped.indexOf;

  // Année scolaire choisie — doit appartenir à l'établissement.
  const year = await prisma.academicYear.findFirst({
    where: { id: academicYearId, schoolId: ctx.schoolId },
    select: { id: true, status: true, name: true },
  });
  if (!year) {
    return {
      rows: [],
      resolved: [],
      fingerprint: "",
      summary: emptySummary(),
      globalError: "Année scolaire inconnue",
    };
  }

  const seen = new Map<string, number>();
  const resolved = dataRows.map((r) => resolveRow(r, indexOf, seen));

  // Résolution des classes (par nom, dans l'établissement ET l'année choisis).
  const classNames = [
    ...new Set(
      resolved.map((r) => r.classroomName).filter((n): n is string => !!n),
    ),
  ];
  const classrooms = classNames.length
    ? await prisma.classroom.findMany({
        where: {
          schoolId: ctx.schoolId,
          academicYearId,
          name: { in: classNames, mode: "insensitive" },
        },
        select: { id: true, name: true },
      })
    : [];
  const classroomsByName = new Map<string, { id: string; name: string }[]>();
  for (const c of classrooms) {
    const k = c.name.toLowerCase();
    classroomsByName.set(k, [...(classroomsByName.get(k) ?? []), c]);
  }

  // Élèves existants correspondant aux matricules du fichier.
  const mats = resolved.map((r) => r.matricule).filter(Boolean);
  const existing = mats.length
    ? await prisma.student.findMany({
        where: { schoolId: ctx.schoolId, matricule: { in: mats } },
        select: {
          id: true,
          matricule: true,
          firstName: true,
          lastName: true,
          sex: true,
          birthDate: true,
          birthPlace: true,
          phone: true,
          email: true,
          address: true,
          enrollments: {
            where: { academicYearId, status: "ENROLLED" },
            select: { classroomId: true },
          },
        },
      })
    : [];
  const byMatricule = new Map(existing.map((s) => [s.matricule, s]));

  // Règle « une inscription ENROLLED par année » (sauf réglage contraire)
  // — même lecture que enrollStudent.
  const school = await prisma.school.findUnique({
    where: { id: ctx.schoolId },
    select: { settings: true },
  });
  const settings = school?.settings;
  const allowMultiple =
    !!settings &&
    typeof settings === "object" &&
    !Array.isArray(settings) &&
    (settings as Record<string, unknown>).allowMultipleEnrollments === true;

  const limit = await checkLimit(ctx.schoolId, "students");
  let enrollBudget =
    limit.ok || limit.max == null || limit.count == null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, limit.max - limit.count);

  const rows: StudentPreviewRow[] = [];
  const requiresEnrollmentPermission = classNames.length > 0;

  for (const r of resolved) {
    const errors = [...r.issues];
    const row: StudentPreviewRow = {
      line: r.line,
      matricule: r.matricule,
      action: "error",
      displayName:
        [r.input.lastName, r.input.firstName].filter(Boolean).join(" ") ||
        r.matricule,
      changes: [],
      enrollment: null,
      errors,
    };
    rows.push(row);
    if (errors.length > 0) continue;

    const current = byMatricule.get(r.matricule);
    const optFields = [
      "sex",
      "birthDate",
      "birthPlace",
      "phone",
      "email",
      "address",
    ] as const;

    if (!current) {
      // Création : matricule/nom/prénom requis — vérifiés ici car la
      // validation zod est partielle (vide = « conserver » en mise à jour).
      if (!r.input.lastName) {
        errors.push({
          line: r.line,
          column: "nom",
          value: null,
          reason: "Nom obligatoire (création)",
        });
      }
      if (!r.input.firstName) {
        errors.push({
          line: r.line,
          column: "prenom",
          value: null,
          reason: "Prénom obligatoire (création)",
        });
      }
      for (const f of optFields) {
        const v = r.input[f];
        if (v !== undefined && v !== null) {
          row.changes.push({
            field: FIELD_LABELS[f],
            from: null,
            to: fmtValue(f, v),
          });
        }
      }
      row.action = "create";
    } else {
      // Mise à jour : seuls les champs fournis changent.
      const desired: Record<string, string | null> = {
        matricule: current.matricule,
        lastName: current.lastName,
        firstName: current.firstName,
        sex: current.sex,
        birthDate: current.birthDate
          ? current.birthDate.toISOString().slice(0, 10)
          : null,
        birthPlace: current.birthPlace,
        phone: current.phone,
        email: current.email,
        address: current.address,
      };
      let changed = false;
      for (const f of ["lastName", "firstName"] as const) {
        const v = r.input[f];
        if (v && v !== desired[f]) {
          row.changes.push({ field: FIELD_LABELS[f], from: desired[f], to: v });
          changed = true;
        }
      }
      for (const f of optFields) {
        const v = r.input[f];
        if (v === undefined) continue; // absent → conservé
        const cur = desired[f];
        if (v === null) {
          if (cur !== null) {
            row.changes.push({
              field: FIELD_LABELS[f],
              from: cur,
              to: null,
              erase: true,
            });
            changed = true;
          }
          continue;
        }
        const norm = fmtValue(f, v);
        if (norm !== cur) {
          row.changes.push({ field: FIELD_LABELS[f], from: cur, to: norm });
          changed = true;
        }
      }
      row.action = changed ? "update" : "unchanged";
    }

    // Inscription (colonne classe)
    if (r.classroomName) {
      const cands = classroomsByName.get(r.classroomName.toLowerCase()) ?? [];
      if (cands.length === 0) {
        errors.push({
          line: r.line,
          column: "classe",
          value: r.classroomName,
          reason: `Classe inconnue dans l'année « ${year.name} »`,
        });
      } else if (cands.length > 1) {
        errors.push({
          line: r.line,
          column: "classe",
          value: r.classroomName,
          reason: "Nom de classe ambigu (plusieurs classes portent ce nom)",
        });
      } else if (year.status === "CLOSED") {
        errors.push({
          line: r.line,
          column: "classe",
          value: r.classroomName,
          reason: "Année scolaire fermée",
        });
      } else {
        const classroom = cands[0];
        const enrolled = current?.enrollments ?? [];
        const already = enrolled.find((e) => e.classroomId === classroom.id);
        if (already) {
          row.enrollment = {
            classroomName: classroom.name,
            action: "existing",
          };
        } else if (!allowMultiple && enrolled.length > 0) {
          errors.push({
            line: r.line,
            column: "classe",
            value: r.classroomName,
            reason: "Élève déjà inscrit dans une autre classe cette année",
          });
        } else if (enrollBudget <= 0) {
          errors.push({
            line: r.line,
            column: "classe",
            value: r.classroomName,
            reason: "Limite d'élèves de l'abonnement atteinte",
          });
        } else {
          row.enrollment = {
            classroomName: classroom.name,
            action: "create",
          };
          enrollBudget--;
        }
      }
    }
    if (errors.length > 0) row.action = "error";
  }

  const summary = summarize(rows);
  const fingerprint = sha256(
    canonical({ kind: "students", academicYearId, rows }),
  );
  return { rows, resolved, fingerprint, summary, requiresEnrollmentPermission };
}

function fmtValue(field: string, v: unknown): string | null {
  if (v == null) return null;
  if (field === "email") return String(v).trim().toLowerCase();
  if (field === "birthDate") {
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
  }
  return String(v);
}

function emptySummary(): StudentsPreview["summary"] {
  return {
    total: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    enrollments: 0,
    erased: 0,
    errors: 0,
  };
}

function summarize(rows: StudentPreviewRow[]): StudentsPreview["summary"] {
  const s = emptySummary();
  s.total = rows.length;
  for (const r of rows) {
    if (r.action === "create") s.created++;
    else if (r.action === "update") s.updated++;
    else if (r.action === "unchanged") s.unchanged++;
    else s.errors++;
    if (r.enrollment?.action === "create") s.enrollments++;
    s.erased += r.changes.filter((c) => c.erase).length;
  }
  return s;
}

async function assertEnrollmentPermission(ctx: SchoolCtx, needed: boolean) {
  if (!needed) return true;
  return userHasSchoolPermission({
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    permissionKey: "enrollment.manage",
  });
}

export async function previewStudentsImport(
  ctx: SchoolCtx,
  source: ImportSource,
  academicYearId: string,
): Promise<{ ok: true; preview: StudentsPreview } | { ok: false; error: string }> {
  const a = await analyze(ctx, source, academicYearId);
  if (a.globalError) return { ok: false, error: a.globalError };
  if (!(await assertEnrollmentPermission(ctx, a.requiresEnrollmentPermission ?? false))) {
    return {
      ok: false,
      error: "La colonne « classe » exige la permission enrollment.manage",
    };
  }
  const { token, expiresAt } = signPreviewToken({
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    kind: "students",
    previewHash: a.fingerprint,
  });
  return {
    ok: true,
    preview: { academicYearId, summary: a.summary, rows: a.rows, token, expiresAt },
  };
}

export interface StudentsCommitResult {
  created: number;
  updated: number;
  unchanged: number;
  enrollments: number;
  /** Créances créées pour les inscriptions nouvelles. */
  chargesCreated: number;
  /** Inscriptions pour lesquelles aucun tarif obligatoire n'est applicable. */
  noTariffs: number;
  /** Inscriptions dont la génération de créances a échoué (reprise
   *  idempotente possible depuis le dossier financier). */
  chargesFailed: number;
  errors: ImportIssue[];
}

export async function commitStudentsImport(
  ctx: SchoolCtx,
  source: ImportSource,
  academicYearId: string,
  expectedFingerprint: string,
): Promise<
  | { ok: true; result: StudentsCommitResult }
  | { ok: false; error: "STALE" | string }
> {
  const a = await analyze(ctx, source, academicYearId);
  if (a.globalError) return { ok: false, error: a.globalError };
  if (a.fingerprint !== expectedFingerprint) return { ok: false, error: "STALE" };
  if (!(await assertEnrollmentPermission(ctx, a.requiresEnrollmentPermission ?? false))) {
    return {
      ok: false,
      error: "La colonne « classe » exige la permission enrollment.manage",
    };
  }

  const year = await prisma.academicYear.findFirst({
    where: { id: academicYearId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!year) return { ok: false, error: "Année scolaire inconnue" };

  const classNames = [
    ...new Set(
      a.resolved.map((r) => r.classroomName).filter((n): n is string => !!n),
    ),
  ];
  const classrooms = classNames.length
    ? await prisma.classroom.findMany({
        where: {
          schoolId: ctx.schoolId,
          academicYearId,
          name: { in: classNames, mode: "insensitive" },
        },
        select: { id: true, name: true },
      })
    : [];
  const classroomByName = new Map(
    classrooms.map((c) => [c.name.toLowerCase(), c]),
  );

  const existingByMat = new Map(
    (
      await prisma.student.findMany({
        where: {
          schoolId: ctx.schoolId,
          matricule: { in: a.resolved.map((r) => r.matricule).filter(Boolean) },
        },
        select: { id: true, matricule: true },
      })
    ).map((s) => [s.matricule, s.id]),
  );

  const result: StudentsCommitResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    enrollments: 0,
    chargesCreated: 0,
    noTariffs: 0,
    chargesFailed: 0,
    errors: [],
  };

  for (let i = 0; i < a.rows.length; i++) {
    const prow = a.rows[i];
    const r = a.resolved[i];
    if (prow.action === "error") {
      result.errors.push(...prow.errors);
      continue;
    }

    const classroom = r.classroomName
      ? classroomByName.get(r.classroomName.toLowerCase())
      : undefined;
    const wantsEnrollment = prow.enrollment?.action === "create" && classroom;

    // Une transaction par ligne : élève + inscription atomiques.
    let enrolledStudentId: string | null = null;
    try {
      await prisma.$transaction(async (tx) => {
        let studentId = existingByMat.get(r.matricule);
        if (prow.action === "create") {
          const res = await createStudent(
            ctx,
            {
              matricule: r.input.matricule,
              firstName: r.input.firstName,
              lastName: r.input.lastName,
              sex: r.input.sex ?? undefined,
              birthDate: r.input.birthDate ?? undefined,
              birthPlace: r.input.birthPlace ?? undefined,
              phone: r.input.phone ?? undefined,
              email: r.input.email ?? undefined,
              address: r.input.address ?? undefined,
            },
            tx,
          );
          if (!res.ok) throw new Error(res.error);
          studentId = res.result.id;
        } else if (prow.action === "update" && studentId) {
          // Patch depuis les valeurs normalisées : champ absent = conservé,
          // null = effacement explicite (__EFFACER__).
          const changedLabels = new Set(prow.changes.map((c) => c.field));
          const patch: Partial<{
            lastName: string;
            firstName: string;
            sex: "MALE" | "FEMALE" | null;
            birthDate: string;
            birthPlace: string;
            phone: string;
            email: string;
            address: string;
          }> = {};
          const setIf = (
            label: string,
            key: keyof typeof patch,
            v: string | null | undefined,
          ) => {
            if (!changedLabels.has(label) || v === undefined) return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (patch as any)[key] = v === null ? (key === "sex" ? null : "") : v;
          };
          setIf("nom", "lastName", r.input.lastName);
          setIf("prenom", "firstName", r.input.firstName);
          setIf("sexe", "sex", r.input.sex);
          setIf("date_naissance", "birthDate", r.input.birthDate);
          setIf("lieu_naissance", "birthPlace", r.input.birthPlace);
          setIf("telephone", "phone", r.input.phone);
          setIf("email", "email", r.input.email);
          setIf("adresse", "address", r.input.address);
          if (Object.keys(patch).length > 0) {
            const res = await updateStudent(ctx, studentId, patch, tx);
            if (!res.ok) throw new Error(res.error);
          }
        }
        if (wantsEnrollment && studentId) {
          const res = await enrollStudent(
            ctx,
            {
              studentId,
              classroomId: classroom.id,
              academicYearId,
            },
            tx,
          );
          if (!res.ok) throw new Error(res.error);
          enrolledStudentId = studentId;
        }
      });
    } catch (e) {
      result.errors.push({
        line: prow.line,
        column: null,
        value: r.matricule,
        reason: `Écriture refusée : ${e instanceof Error ? e.message : "ERREUR"}`,
      });
      continue;
    }

    if (prow.action === "create") result.created++;
    else if (prow.action === "update") result.updated++;
    else result.unchanged++;
    if (wantsEnrollment) {
      result.enrollments++;
      // Créances après commit — même règle que le guichet F2-D : un échec
      // de génération ne remet pas en cause l'inscription, et la reprise
      // idempotente reste possible depuis le dossier financier. Seules les
      // inscriptions nouvelles déclenchent la génération : un élève déjà
      // inscrit réimporté ne produit pas de créances supplémentaires.
      try {
        const chg = await generateStudentCharges(ctx, {
          studentId: enrolledStudentId!,
          academicYearId,
        });
        if (!chg.ok) throw new Error(chg.error);
        result.chargesCreated += chg.result.created;
        if (chg.result.tariffs === 0) result.noTariffs++;
      } catch (e) {
        result.chargesFailed++;
        result.errors.push({
          line: prow.line,
          column: "frais",
          value: r.matricule,
          reason: `Inscription enregistrée, frais non générés (${e instanceof Error ? e.message : "ERREUR"}) — reprise possible depuis le dossier financier`,
        });
      }
    }
  }

  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "student.import",
    entity: "Student",
    metadata: {
      total: a.summary.total,
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
      enrollments: result.enrollments,
      chargesCreated: result.chargesCreated,
      noTariffs: result.noTariffs,
      chargesFailed: result.chargesFailed,
      failed: result.errors.length,
      academicYearId,
    },
  });

  return { ok: true, result };
}
