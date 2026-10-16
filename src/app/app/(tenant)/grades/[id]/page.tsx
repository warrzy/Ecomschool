import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { getAssessment } from "@/lib/services/grading/assessments";
import { getGradeGrid } from "@/lib/services/grading/grades";
import {
  saveGradesAction,
  setAssessmentStatusAction,
} from "@/app/app/(tenant)/grades/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

const GRADE_STATUSES: Record<string, string> = {
  ENTERED: "Saisie",
  MISSING: "Non noté",
  ABSENT: "Absent",
  EXEMPT: "Dispensé",
  CANCELLED: "Annulée",
};

export default async function GradeEntryPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("grades.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const assessment = await getAssessment(c, id);
  if (!assessment) notFound();

  const grid = await getGradeGrid(c, id);
  if (!grid.ok) notFound();

  const canEnter =
    (await userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "grades.enter",
    })) && ["OPEN", "SUBMITTED", "DRAFT"].includes(assessment.status);

  const unmarked = grid.result.rows.filter((r) => r.status === "MISSING").length;
  const inputCls =
    "w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">
          <Link href="/app/grades" className="hover:underline">Évaluations</Link> / Saisie des notes
        </div>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            {assessment.title}
          </h1>
          <div className="flex flex-wrap shrink-0 items-center gap-2">
            <a
              href={`/app/grades/export?assessment=${id}&format=xlsx`}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
            >
              Exporter XLSX
            </a>
            <a
              href={`/app/grades/export?assessment=${id}&format=csv`}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
            >
              Exporter CSV
            </a>
            <Link
              href="/app/grades"
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
            >
              Retour
            </Link>
          </div>
        </div>
        <div className="mt-1 text-sm text-zinc-500">
          {assessment.classroom.name} · {assessment.subject.name} ·{" "}
          {assessment.type.name} · barème /{assessment.maxScore} · coef {assessment.coefficient}
          {assessment.academicPeriod ? ` · ${assessment.academicPeriod.name}` : ""}
        </div>
        {ok ? (
          <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {ok === "imported" ? `Import réussi (${sp.count ?? ""} lignes).` : okMessage(ok)}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error === "OUT_OF_RANGE"
              ? "Une note est hors du barème — rien n'a été enregistré."
              : error === "LOCKED"
                ? "L'évaluation ou la période est verrouillée."
                : error === "FORBIDDEN"
                  ? "Vous n'êtes pas autorisé sur cette classe/matière."
                  : errorMessage(error)}
          </div>
        ) : null}
        <div className="mt-2 text-sm text-zinc-500">
          {unmarked} élève(s) non noté(s) — une absence n&apos;est pas un zéro automatique.
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <form action={saveGradesAction}>
          <input type="hidden" name="assessmentId" value={id} />
          <div className="overflow-x-auto">
          <table aria-label={`Notes de l'évaluation : ${assessment.title}`} className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <th scope="col" className="py-2 pr-3">Matricule</th>
                <th scope="col" className="py-2 pr-3">Élève</th>
                <th scope="col" className="py-2 pr-3 w-28">Note /{assessment.maxScore}</th>
                <th scope="col" className="py-2 pr-3 w-36">Statut</th>
                <th scope="col" className="py-2">Observation</th>
              </tr>
            </thead>
            <tbody>
              {grid.result.rows.map((r) => (
                <tr key={r.studentId} className="border-b border-zinc-100">
                  <td className="py-1.5 pr-3 text-zinc-500">{r.matricule}</td>
                  <td className="py-1.5 pr-3 font-medium">{r.name}</td>
                  <td className="py-1.5 pr-3">
                    <input
                      name={`v_${r.studentId}`}
                      type="number"
                      step="0.25"
                      min="0"
                      max={assessment.maxScore}
                      defaultValue={r.value ?? ""}
                      disabled={!canEnter}
                      aria-label={`Note de ${r.name} (sur ${assessment.maxScore})`}
                      className={inputCls}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <select name={`s_${r.studentId}`} defaultValue={r.status} disabled={!canEnter} aria-label={`Statut de ${r.name}`} className={inputCls}>
                      {Object.entries(GRADE_STATUSES).map(([k, l]) => (
                        <option key={k} value={k}>{l}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5">
                    <input
                      name={`o_${r.studentId}`}
                      defaultValue={r.observation ?? ""}
                      disabled={!canEnter}
                      aria-label={`Observation — ${r.name}`}
                      className={inputCls}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {canEnter ? (
            <div className="mt-4 flex gap-3">
              <SubmitButton className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                Enregistrer (brouillon)
              </SubmitButton>
            </div>
          ) : null}
        </form>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {canEnter ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="mb-3 text-sm font-medium text-zinc-900">Import de notes</div>
            <p className="mb-3 text-xs text-zinc-500">
              Assistant CSV/Excel : modèle pré-rempli des élèves inscrits,
              analyse sans écriture, aperçu puis confirmation — tout ou rien.
            </p>
            <Link
              href={`/app/grades/${id}/import`}
              className="inline-block rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
            >
              Ouvrir l’assistant d’import
            </Link>
          </div>
        ) : null}

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 text-sm font-medium text-zinc-900">Soumission</div>
          <p className="mb-3 text-xs text-zinc-500">
            Une fois les notes saisies, soumettez l&apos;évaluation à la validation de la direction.
          </p>
          {assessment.status === "OPEN" || assessment.status === "DRAFT" ? (
            <form action={setAssessmentStatusAction}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="status" value="SUBMITTED" />
              <SubmitButton className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                Soumettre à validation
              </SubmitButton>
            </form>
          ) : (
            <div className="text-sm text-zinc-500">Statut : {statusLabel("assessment", assessment.status)}</div>
          )}
        </div>
      </div>
    </div>
  );
}
