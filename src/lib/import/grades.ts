/**
 * Import de notes par évaluation : analyse sans écriture puis confirmation
 * atomique via saveGrades (verrous, périmètre enseignant, GradeRevision et
 * audit conservés). Aucune écriture directe sur Grade.
 *
 * Règles :
 * - élèves autorisés = grille de l'évaluation (inscrits à sa date) ;
 * - matricule inconnu ou hors classe = erreur bloquante ;
 * - statuts importables : ENTERED, MISSING, ABSENT, EXEMPT (CANCELLED refusé) ;
 * - ENTERED exige une note 0..maxScore ; les autres exigent une note vide ;
 * - import atomique : la moindre ligne en erreur bloque tout l'import.
 */
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { getGradeGrid, saveGrades } from "@/lib/services/grading/grades";
import { teacherAllowed } from "@/lib/services/grading/assessments";
import { teacherIdForUser } from "@/lib/services/attendance";
import type { GradeStatus } from "@prisma/client";
import type { ImportRawRow } from "./csv";
import { parseCsvText } from "./csv";
import { readXlsxRows } from "./xlsx";
import { canonical, sha256, signPreviewToken } from "./token";
import type { ImportIssue } from "./students";

export const MAX_GRADE_ROWS = 200;

export const GRADE_TEMPLATE_HEADERS = [
  "matricule",
  "nom",
  "prenom",
  "note",
  "statut",
  "observation",
] as const;

const IMPORTABLE_STATUSES: readonly GradeStatus[] = [
  "ENTERED",
  "MISSING",
  "ABSENT",
  "EXEMPT",
];

type SchoolCtx = { userId: string; schoolId: string };

export interface GradePreviewRow {
  line: number;
  matricule: string;
  name: string;
  action:
    | "create"
    | "update"
    | "status-change"
    | "unchanged"
    | "error";
  from: { value: number | null; status: GradeStatus } | null;
  to: { value: number | null; status: GradeStatus; observation: string | null };
  errors: ImportIssue[];
}

export interface GradesPreview {
  assessment: {
    id: string;
    title: string;
    maxScore: number;
    status: string;
    periodLocked: boolean;
  };
  summary: {
    total: number;
    created: number;
    updated: number;
    statusChanged: number;
    unchanged: number;
    errors: number;
  };
  rows: GradePreviewRow[];
  token: string;
  expiresAt: string;
}

const HEADER_FIELDS = [
  "matricule",
  "nom",
  "prenom",
  "note",
  "statut",
  "observation",
] as const;
type GradeField = (typeof HEADER_FIELDS)[number];

function mapHeader(
  cells: string[],
): { ok: true; indexOf: Map<GradeField, number> } | { ok: false; reason: string } {
  const norm = (h: string) =>
    h
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[\s-]+/g, "_");
  const aliases: Record<GradeField, readonly string[]> = {
    matricule: ["matricule"],
    nom: ["nom", "last_name", "lastname"],
    prenom: ["prenom", "first_name", "firstname"],
    note: ["note", "valeur", "value", "score"],
    statut: ["statut", "status"],
    observation: ["observation", "observations", "commentaire", "remarque"],
  };
  const indexOf = new Map<GradeField, number>();
  for (let i = 0; i < cells.length; i++) {
    const h = norm(cells[i]);
    if (!h) continue;
    const f = HEADER_FIELDS.find((k) => aliases[k].some((a) => norm(a) === h));
    if (!f) return { ok: false, reason: `Colonne inconnue : « ${cells[i]} »` };
    if (indexOf.has(f)) {
      return { ok: false, reason: `Colonne dupliquée : « ${cells[i]} »` };
    }
    indexOf.set(f, i);
  }
  if (!indexOf.has("matricule") || !indexOf.has("note")) {
    return {
      ok: false,
      reason: "Colonnes obligatoires absentes : « matricule », « note »",
    };
  }
  return { ok: true, indexOf };
}

interface ResolvedGradeRow {
  line: number;
  matricule: string;
  value: number | null;
  status: GradeStatus;
  observation: string | null;
  issues: ImportIssue[];
}

function resolveGradeRow(
  row: ImportRawRow,
  indexOf: Map<GradeField, number>,
  maxScore: number,
  seen: Map<string, number>,
): ResolvedGradeRow {
  const issues: ImportIssue[] = [];
  const cell = (f: GradeField) => {
    const i = indexOf.get(f);
    return i == null ? "" : (row.cells[i] ?? "").trim();
  };

  const matricule = cell("matricule");
  if (!matricule) {
    issues.push({
      line: row.line,
      column: "matricule",
      value: null,
      reason: "Matricule obligatoire",
    });
  } else {
    const first = seen.get(matricule.toUpperCase());
    if (first != null) {
      issues.push({
        line: row.line,
        column: "matricule",
        value: matricule,
        reason: `Matricule en double dans le fichier (déjà ligne ${first})`,
      });
    } else {
      seen.set(matricule.toUpperCase(), row.line);
    }
  }

  const rawNote = cell("note");
  let value: number | null = null;
  if (rawNote !== "") {
    const n = Number(rawNote.replace(",", "."));
    if (!Number.isFinite(n)) {
      issues.push({
        line: row.line,
        column: "note",
        value: rawNote,
        reason: "Note invalide (nombre attendu)",
      });
    } else {
      value = n;
    }
  }

  const rawStatus = cell("statut").toUpperCase();
  let status: GradeStatus;
  if (rawStatus === "") {
    status = value != null ? "ENTERED" : "MISSING";
  } else if (rawStatus === "CANCELLED") {
    issues.push({
      line: row.line,
      column: "statut",
      value: rawStatus,
      reason: "Le statut CANCELLED n'est pas importable",
    });
    status = "MISSING";
  } else if (
    (IMPORTABLE_STATUSES as readonly string[]).includes(rawStatus)
  ) {
    status = rawStatus as GradeStatus;
  } else {
    issues.push({
      line: row.line,
      column: "statut",
      value: rawStatus,
      reason: `Statut inconnu (${IMPORTABLE_STATUSES.join(", ")})`,
    });
    status = "MISSING";
  }

  if (status === "ENTERED") {
    if (value == null) {
      issues.push({
        line: row.line,
        column: "note",
        value: rawNote || null,
        reason: "Le statut ENTERED exige une note",
      });
    } else if (value < 0 || value > maxScore) {
      issues.push({
        line: row.line,
        column: "note",
        value: rawNote,
        reason: `Note hors barème (0 à ${maxScore})`,
      });
    }
  } else if (value != null) {
    issues.push({
      line: row.line,
      column: "note",
      value: rawNote,
      reason: `Le statut ${status} exige une note vide`,
    });
  }

  return {
    line: row.line,
    matricule,
    value,
    status,
    observation: cell("observation") || null,
    issues,
  };
}

interface GradeAnalysis {
  assessment: GradesPreview["assessment"] | null;
  rows: GradePreviewRow[];
  /** Entrées à écrire (lignes valides et modifiantes), ordre fichier. */
  entries: {
    studentId: string;
    value: number | null;
    status: GradeStatus;
    observation: string | null;
  }[];
  fingerprint: string;
  summary: GradesPreview["summary"];
  globalError?: string;
}

async function analyzeGrades(
  ctx: SchoolCtx,
  assessmentId: string,
  source: { kind: "csv"; text: string } | { kind: "xlsx"; buffer: ArrayBuffer },
  opts: { asTeacher?: boolean },
): Promise<GradeAnalysis> {
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, schoolId: ctx.schoolId },
    select: {
      id: true,
      title: true,
      maxScore: true,
      status: true,
      classroomId: true,
      subjectId: true,
      academicPeriod: { select: { isLocked: true } },
    },
  });
  const empty: GradeAnalysis = {
    assessment: null,
    rows: [],
    entries: [],
    fingerprint: "",
    summary: { total: 0, created: 0, updated: 0, statusChanged: 0, unchanged: 0, errors: 0 },
  };
  if (!assessment) return { ...empty, globalError: "Évaluation introuvable" };
  if (
    assessment.academicPeriod?.isLocked ||
    ["VALIDATED", "PUBLISHED", "CANCELLED"].includes(assessment.status)
  ) {
    return {
      ...empty,
      assessment: {
        id: assessment.id,
        title: assessment.title,
        maxScore: assessment.maxScore,
        status: assessment.status,
        periodLocked: !!assessment.academicPeriod?.isLocked,
      },
      globalError:
        "Évaluation verrouillée (période clôturée ou statut final) — import impossible",
    };
  }

  if (opts.asTeacher) {
    const tid = await teacherIdForUser(ctx);
    if (
      !tid ||
      !(await teacherAllowed(ctx, tid, assessment.classroomId, assessment.subjectId))
    ) {
      return { ...empty, globalError: "Évaluation hors de votre périmètre d'enseignement" };
    }
  }

  const res =
    source.kind === "xlsx"
      ? await readXlsxRows(source.buffer, MAX_GRADE_ROWS)
      : parseCsvText(source.text, MAX_GRADE_ROWS);
  if (!res.ok) {
    const reason =
      res.error === "EMPTY"
        ? "Fichier vide"
        : res.error === "TOO_MANY_ROWS"
          ? `Trop de lignes (maximum ${MAX_GRADE_ROWS})`
          : res.error === "FORMULA"
            ? "Les cellules contenant des formules sont refusées"
            : "Fichier CSV malformé (guillemets non fermés ?)";
    return { ...empty, globalError: reason };
  }

  const [headerRow, ...dataRows] = res.rows;
  const mapped = mapHeader(headerRow.cells);
  if (!mapped.ok) return { ...empty, globalError: mapped.reason };

  const grid = await getGradeGrid(ctx, assessmentId);
  if (!grid.ok) return { ...empty, globalError: "Évaluation introuvable" };
  const gridByMat = new Map(grid.result.rows.map((g) => [g.matricule, g]));
  // La grille fusionne « pas de note » et « ligne MISSING enregistrée » —
  // on distingue les deux pour un libellé d'aperçu exact.
  const existingGradeIds = new Set(
    (
      await prisma.grade.findMany({
        where: { assessmentId, schoolId: ctx.schoolId },
        select: { studentId: true },
      })
    ).map((g) => g.studentId),
  );

  const seen = new Map<string, number>();
  const resolved = dataRows.map((r) =>
    resolveGradeRow(r, mapped.indexOf, assessment.maxScore, seen),
  );

  const rows: GradePreviewRow[] = [];
  const entries: GradeAnalysis["entries"] = [];
  for (const r of resolved) {
    const g = r.matricule ? gridByMat.get(r.matricule) : undefined;
    const prow: GradePreviewRow = {
      line: r.line,
      matricule: r.matricule,
      name: g?.name ?? "",
      action: "error",
      from: g ? { value: g.value, status: g.status } : null,
      to: {
        value: r.status === "ENTERED" ? r.value : null,
        status: r.status,
        observation: r.observation,
      },
      errors: [...r.issues],
    };
    rows.push(prow);
    if (prow.errors.length > 0) continue;

    if (!g) {
      prow.errors.push({
        line: r.line,
        column: "matricule",
        value: r.matricule,
        reason: "Matricule inconnu ou élève hors de cette classe",
      });
      continue;
    }
    prow.name = g.name;
    const newValue = r.status === "ENTERED" ? r.value : null;
    const sameValue = g.value === newValue;
    const sameStatus = g.status === r.status;
    const sameObs = (g.observation ?? null) === (r.observation ?? null);

    if (sameValue && sameStatus && sameObs) {
      // Inchangé : rien à écrire (un statut MISSING dérivé sans ligne
      // existante ne crée pas d'enregistrement superflu).
      prow.action = "unchanged";
      continue;
    }

    const statusOnly = sameValue && !sameStatus && sameObs;
    const hasExisting = existingGradeIds.has(g.studentId);
    prow.action = !hasExisting
      ? "create"
      : statusOnly
        ? "status-change"
        : "update";
    entries.push({
      studentId: g.studentId,
      value: newValue,
      status: r.status,
      observation: r.observation,
    });
  }

  const summary = {
    total: rows.length,
    created: rows.filter((r) => r.action === "create").length,
    updated: rows.filter((r) => r.action === "update").length,
    statusChanged: rows.filter((r) => r.action === "status-change").length,
    unchanged: rows.filter((r) => r.action === "unchanged").length,
    errors: rows.filter((r) => r.action === "error").length,
  };
  const fingerprint = sha256(
    canonical({
      kind: "grades",
      assessmentId,
      maxScore: assessment.maxScore,
      status: assessment.status,
      locked: !!assessment.academicPeriod?.isLocked,
      grid: grid.result.rows.map((g) => [
        g.studentId,
        g.matricule,
        g.value,
        g.status,
        g.observation,
      ]),
      rows,
    }),
  );
  return {
    assessment: {
      id: assessment.id,
      title: assessment.title,
      maxScore: assessment.maxScore,
      status: assessment.status,
      periodLocked: !!assessment.academicPeriod?.isLocked,
    },
    rows,
    entries,
    fingerprint,
    summary,
  };
}

export async function previewGradesImport(
  ctx: SchoolCtx,
  assessmentId: string,
  source: { kind: "csv"; text: string } | { kind: "xlsx"; buffer: ArrayBuffer },
  opts: { asTeacher?: boolean } = {},
): Promise<{ ok: true; preview: GradesPreview } | { ok: false; error: string }> {
  const a = await analyzeGrades(ctx, assessmentId, source, opts);
  if (a.globalError || !a.assessment) {
    return { ok: false, error: a.globalError ?? "Analyse impossible" };
  }
  const { token, expiresAt } = signPreviewToken({
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    kind: "grades",
    previewHash: a.fingerprint,
  });
  return {
    ok: true,
    preview: {
      assessment: a.assessment,
      summary: a.summary,
      rows: a.rows,
      token,
      expiresAt,
    },
  };
}

export async function commitGradesImport(
  ctx: SchoolCtx,
  assessmentId: string,
  source: { kind: "csv"; text: string } | { kind: "xlsx"; buffer: ArrayBuffer },
  expectedFingerprint: string,
  opts: { asTeacher?: boolean } = {},
): Promise<
  | { ok: true; result: { saved: number; unchanged: number } }
  | { ok: false; error: "STALE" | "HAS_ERRORS" | string }
> {
  const a = await analyzeGrades(ctx, assessmentId, source, opts);
  if (a.globalError || !a.assessment) {
    return { ok: false, error: a.globalError ?? "Analyse impossible" };
  }
  if (a.fingerprint !== expectedFingerprint) return { ok: false, error: "STALE" };
  // Politique atomique : la moindre erreur bloque tout l'import.
  if (a.summary.errors > 0) return { ok: false, error: "HAS_ERRORS" };
  if (a.entries.length === 0) {
    return { ok: true, result: { saved: 0, unchanged: a.summary.unchanged } };
  }

  const res = await saveGrades(ctx, assessmentId, a.entries, opts);
  if (!res.ok) return { ok: false, error: res.error };

  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "grades.import",
    entity: "Assessment",
    entityId: assessmentId,
    metadata: {
      total: a.summary.total,
      saved: res.result.saved,
      unchanged: a.summary.unchanged,
    },
  });
  return { ok: true, result: { saved: res.result.saved, unchanged: a.summary.unchanged } };
}
