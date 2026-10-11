// GradeCalculationService — fonctions pures, aucune dépendance Prisma.
// Toutes les interfaces (services, pages, tests, PDF) doivent utiliser
// ces fonctions pour garantir la cohérence des résultats.

export type RoundingMode = "HALF_UP" | "FLOOR" | "CEIL";
export type MissingGradePolicy = "EXCLUDE" | "ZERO";
export type TieRule = "SHARED_RANK" | "DENSE_RANK";

export interface GradingRules {
  maxScore: number; // barème de sortie (20 par défaut)
  minScore: number;
  precision: number; // décimales (ex. 2 → 14,50)
  rounding: RoundingMode;
  passMark: number;
  missingGradePolicy: MissingGradePolicy;
  absentPolicy: MissingGradePolicy;
  exemptPolicy: MissingGradePolicy;
  tieRule: TieRule;
  perSubjectRank: boolean;
  mentions: { label: string; min: number }[];
}

export const DEFAULT_RULES: GradingRules = {
  maxScore: 20,
  minScore: 0,
  precision: 2,
  rounding: "HALF_UP",
  passMark: 10,
  missingGradePolicy: "EXCLUDE",
  absentPolicy: "EXCLUDE",
  exemptPolicy: "EXCLUDE",
  tieRule: "SHARED_RANK",
  perSubjectRank: true,
  mentions: [
    { label: "Excellent", min: 16 },
    { label: "Très bien", min: 14 },
    { label: "Bien", min: 12 },
    { label: "Assez bien", min: 10 },
    { label: "Passable", min: 8 },
  ],
};

/** Arrondi selon la règle configurée, sur `precision` décimales. */
export function roundScore(
  value: number,
  precision: number,
  mode: RoundingMode = "HALF_UP",
): number {
  const f = 10 ** precision;
  const v = value * f;
  switch (mode) {
    case "FLOOR":
      return Math.floor(v + 1e-9) / f;
    case "CEIL":
      return Math.ceil(v - 1e-9) / f;
    default:
      return Math.round(v + 1e-9) / f;
  }
}

/** Normalise une note vers le barème de l'établissement (ex. 14/40 → 7/20). */
export function normalizeScore(
  value: number,
  assessmentMax: number,
  rules: GradingRules,
): number {
  if (assessmentMax <= 0) return rules.minScore;
  return (value / assessmentMax) * rules.maxScore;
}

export interface GradeEntry {
  value: number | null;
  status: "ENTERED" | "MISSING" | "ABSENT" | "EXEMPT" | "CANCELLED";
}

export interface AssessmentForCalc {
  maxScore: number;
  coefficient: number;
}

/** Note applicable au calcul selon les politiques de notes manquantes/absentes/dispenses. */
export function applicableValue(
  grade: GradeEntry | undefined,
  assessment: AssessmentForCalc,
  rules: GradingRules,
): { normalized: number; coefficient: number } | null {
  if (!grade) {
    return policyValue("MISSING", assessment, rules);
  }
  switch (grade.status) {
    case "ENTERED": {
      if (grade.value == null) return policyValue("MISSING", assessment, rules);
      return {
        normalized: normalizeScore(grade.value, assessment.maxScore, rules),
        coefficient: assessment.coefficient,
      };
    }
    case "ABSENT":
      return policyValue(rules.absentPolicy === "ZERO" ? "ZERO" : "EXCLUDE", assessment, rules, rules.absentPolicy);
    case "EXEMPT":
      return policyValue(rules.exemptPolicy === "ZERO" ? "ZERO" : "EXCLUDE", assessment, rules, rules.exemptPolicy);
    case "MISSING":
    case "CANCELLED":
    default:
      return policyValue("MISSING", assessment, rules);
  }
}

function policyValue(
  kind: "MISSING" | "ZERO" | "EXCLUDE",
  assessment: AssessmentForCalc,
  rules: GradingRules,
  policy?: MissingGradePolicy,
): { normalized: number; coefficient: number } | null {
  const p = kind === "MISSING" ? rules.missingGradePolicy : policy ?? (kind as MissingGradePolicy);
  if (p === "ZERO") return { normalized: rules.minScore, coefficient: assessment.coefficient };
  return null; // EXCLUDE → ni la note ni le coefficient ne comptent
}

/**
 * Moyenne de matière = Σ(note normalisée × coef évaluation) / Σ(coefs applicables).
 * Retourne null si aucune note applicable.
 */
export function subjectAverage(
  grades: (GradeEntry | undefined)[],
  assessments: AssessmentForCalc[],
  rules: GradingRules,
): { average: number | null; complete: boolean } {
  let num = 0;
  let den = 0;
  let complete = true;
  assessments.forEach((a, i) => {
    const v = applicableValue(grades[i], a, rules);
    if (v) {
      num += v.normalized * v.coefficient;
      den += v.coefficient;
    } else if (a.coefficient > 0) {
      complete = false;
    }
  });
  if (den === 0) return { average: null, complete };
  return { average: num / den, complete };
}

export interface SubjectResultInput {
  subjectId: string;
  coefficient: number; // coefficient de matière (priorité : ClassroomSubject > LevelSubject > 1)
  average: number | null;
}

/**
 * Moyenne générale = Σ(moyenne matière × coef matière) / Σ(coefs applicables).
 */
export function generalAverage(
  subjects: SubjectResultInput[],
): { average: number | null; totalCoef: number; complete: boolean } {
  let num = 0;
  let den = 0;
  let complete = true;
  for (const s of subjects) {
    if (s.average == null) {
      if (s.coefficient > 0) complete = false;
      continue;
    }
    num += s.average * s.coefficient;
    den += s.coefficient;
  }
  if (den === 0) return { average: null, totalCoef: 0, complete };
  return { average: num / den, totalCoef: den, complete };
}

/** Classement : SHARED_RANK (ex æquo partagent le rang, rangs suivants sautés) ou DENSE_RANK. */
export function computeRanks(
  entries: { id: string; average: number | null }[],
  tieRule: TieRule = "SHARED_RANK",
): Map<string, number | null> {
  const ranked = entries
    .filter((e) => e.average != null)
    .sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
  const ranks = new Map<string, number | null>();
  let prev: number | null = null;
  let rank = 0;
  ranked.forEach((e, i) => {
    if (prev !== null && e.average === prev) {
      // ex æquo : même rang
    } else {
      rank = tieRule === "DENSE_RANK" ? rank + 1 : i + 1;
    }
    ranks.set(e.id, rank);
    prev = e.average;
  });
  for (const e of entries) if (e.average == null) ranks.set(e.id, null);
  return ranks;
}

/** Mention la plus haute dont le seuil est atteint. */
export function mentionFor(average: number | null, rules: GradingRules): string | null {
  if (average == null) return null;
  const sorted = [...rules.mentions].sort((a, b) => b.min - a.min);
  return sorted.find((m) => average >= m.min)?.label ?? null;
}

/** Moyenne annuelle = moyenne pondérée des moyennes de périodes. */
export function annualAverage(
  periodResults: { periodId: string; average: number | null }[],
  weights: Record<string, number>,
): number | null {
  let num = 0;
  let den = 0;
  for (const p of periodResults) {
    if (p.average == null) continue;
    const w = weights[p.periodId] ?? 1;
    num += p.average * w;
    den += w;
  }
  return den === 0 ? null : num / den;
}
