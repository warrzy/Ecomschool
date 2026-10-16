import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import { getReportCard, templateFor } from "@/lib/services/grading/reportcards";
import {
  updateResultAnnotationsAction,
  updateSubjectAppreciationAction,
} from "@/app/app/(tenant)/report-cards/actions";

export const instant = false;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  CALCULATED: "Calculé",
  PENDING_VALIDATION: "À valider",
  VALIDATED: "Validé",
  PUBLISHED: "Publié",
  RECTIFIED: "Rectifié",
};

export default async function ReportCardDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("reportcards.read");
  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};

  const card = await getReportCard(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );
  if (!card) notFound();

  const [canValidate, canPrint, result, subjects] = await Promise.all([
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "results.validate" }),
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "reportcards.print" }),
    prisma.studentPeriodResult.findFirst({
      where: {
        schoolId: tenant.schoolId,
        studentId: card.studentId,
        academicPeriodId: card.academicPeriodId,
      },
      select: {
        id: true,
        headTeacherNote: true,
        generalAppreciation: true,
        councilDecision: true,
        directionNote: true,
        directionSignedAt: true,
        directionSignedById: true,
      },
    }),
    prisma.subjectPeriodResult.findMany({
      where: {
        schoolId: tenant.schoolId,
        studentId: card.studentId,
        academicPeriodId: card.academicPeriodId,
      },
      include: { subject: { select: { name: true } } },
      orderBy: { subject: { name: "asc" } },
    }),
  ]);

  const templateKey = await templateFor(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    null,
  );

  const inputCls =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Bulletin {card.identifier}</div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          {card.student.lastName} {card.student.firstName} — {card.classroom.name} ·{" "}
          {card.academicPeriod.name}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs">
            {STATUS_LABELS[card.status]} · v{card.currentVersion}
          </span>
          {canPrint ? (
            <a
              href={`/app/report-cards/pdf?id=${card.id}`}
              target="_blank"
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50"
            >
              Aperçu / PDF
            </a>
          ) : null}
          <Link href="/app/report-cards" className="text-xs text-zinc-500 hover:underline">
            ← Retour aux bulletins
          </Link>
        </div>
        {sp.ok ? (
          <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {sp.ok === "annotations" ? "Appréciations enregistrées. Régénérez le bulletin pour créer une nouvelle version." : "Appréciation enregistrée."}
          </div>
        ) : null}
        {sp.error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {sp.error}
          </div>
        ) : null}
      </div>

      {result ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-zinc-900">
            Appréciations et décisions (modèle : {templateKey})
          </div>
          <form action={updateResultAnnotationsAction} className="grid gap-3 md:grid-cols-2">
            <input type="hidden" name="cardId" value={card.id} />
            <input type="hidden" name="studentId" value={card.studentId} />
            <input type="hidden" name="academicPeriodId" value={card.academicPeriodId} />
            <label className="space-y-1 text-xs text-zinc-500">
              Appréciation du professeur principal
              <textarea name="headTeacherNote" rows={2} defaultValue={result.headTeacherNote ?? ""} className={inputCls} />
            </label>
            <label className="space-y-1 text-xs text-zinc-500">
              Appréciation générale
              <textarea name="generalAppreciation" rows={2} defaultValue={result.generalAppreciation ?? ""} className={inputCls} />
            </label>
            <label className="space-y-1 text-xs text-zinc-500">
              Décision du conseil de classe
              <textarea name="councilDecision" rows={2} defaultValue={result.councilDecision ?? ""} className={inputCls} />
            </label>
            <label className="space-y-1 text-xs text-zinc-500">
              Observation de la direction
              <textarea name="directionNote" rows={2} defaultValue={result.directionNote ?? ""} className={inputCls} />
            </label>
            <div className="flex flex-wrap items-end gap-3 md:col-span-2">
              {canValidate ? (
                <>
                  <label className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
                    <input type="checkbox" name="sign" />
                    Signer au nom de la direction
                    {result.directionSignedAt
                      ? ` (signé le ${new Date(result.directionSignedAt).toLocaleDateString("fr-FR")})`
                      : ""}
                  </label>
                  <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                    Enregistrer
                  </button>
                </>
              ) : (
                <span className="text-xs text-zinc-500">
                  Droits de validation requis pour modifier ces champs.
                </span>
              )}
            </div>
          </form>
        </div>
      ) : null}

      {subjects.length > 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-zinc-900">Appréciations par matière</div>
          <div className="space-y-3">
            {subjects.map((s) => (
              <form key={s.id} action={updateSubjectAppreciationAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="cardId" value={card.id} />
                <input type="hidden" name="studentId" value={card.studentId} />
                <input type="hidden" name="academicPeriodId" value={card.academicPeriodId} />
                <input type="hidden" name="subjectId" value={s.subjectId} />
                <span className="w-40 text-sm font-medium text-zinc-900">{s.subject.name}</span>
                <input
                  aria-label="Appréciation générale" name="appreciation"
                  defaultValue={s.appreciation ?? ""}
                  placeholder="Appréciation"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
                />
                {canValidate ? (
                  <button type="submit" className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50">
                    Enregistrer
                  </button>
                ) : null}
              </form>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-zinc-900">Historique des versions</div>
        <div className="overflow-x-auto">
        <table aria-label="Notes du bulletin" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th scope="col" className="py-2 pr-3">Version</th>
              <th scope="col" className="py-2 pr-3">Date</th>
              <th scope="col" className="py-2 pr-3">Motif</th>
            </tr>
          </thead>
          <tbody>
            {card.versions.map((v) => (
              <tr key={v.id} className="border-b border-zinc-100">
                <td className="py-2 pr-3">v{v.version}</td>
                <td className="py-2 pr-3">{v.createdAt.toLocaleString("fr-FR")}</td>
                <td className="py-2 pr-3">{v.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
