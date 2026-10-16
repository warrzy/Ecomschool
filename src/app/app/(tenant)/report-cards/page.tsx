import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  listReportCards,
  ensureDefaultTemplates,
} from "@/lib/services/grading/reportcards";
import {
  generateClassReportCardsAction,
  rectifyReportCardAction,
} from "@/app/app/(tenant)/report-cards/actions";
import { errorMessage } from "@/lib/ui/errorLabels";

export const instant = false;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  CALCULATED: "Calculé",
  PENDING_VALIDATION: "À valider",
  VALIDATED: "Validé",
  PUBLISHED: "Publié",
  RECTIFIED: "Rectifié",
};

export default async function ReportCardsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("reportcards.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const ok = str("ok");
  const error = str("error");
  const classroomId = str("classroom");
  const periodId = str("period");
  const status = str("status") as
    | "DRAFT"
    | "CALCULATED"
    | "PENDING_VALIDATION"
    | "VALIDATED"
    | "PUBLISHED"
    | "RECTIFIED"
    | undefined;

  const [canGenerate, canValidate, canPrint] = await Promise.all([
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "reportcards.generate" }),
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "reportcards.validate" }),
    userHasSchoolPermission({ userId: tenant.userId, schoolId: tenant.schoolId, permissionKey: "reportcards.print" }),
  ]);

  await ensureDefaultTemplates(c);

  const years = await prisma.academicYear.findMany({
    where: { schoolId: tenant.schoolId },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, isCurrent: true },
  });
  const currentYear = years.find((y) => y.isCurrent) ?? years[0];
  const classrooms = currentYear
    ? await prisma.classroom.findMany({
        where: { schoolId: tenant.schoolId, academicYearId: currentYear.id },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];
  const periods = currentYear
    ? await prisma.academicPeriod.findMany({
        where: { schoolId: tenant.schoolId, academicYearId: currentYear.id },
        orderBy: { number: "asc" },
        select: { id: true, name: true },
      })
    : [];

  const cards = await listReportCards(c, {
    classroomId,
    academicPeriodId: periodId,
    status: status && STATUS_LABELS[status] ? status : undefined,
  });

  const inputCls =
    "rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Bulletins</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Bulletins scolaires ({cards.length})
        </div>
        {ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {ok === "generated" ? `Bulletins générés (${sp.count ?? ""}).` : ok === "rectified" ? "Bulletin rectifié (nouvelle version)." : ok}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error === "INVALID_STATUS" ? "Calculez les moyennes avant de générer les bulletins." : errorMessage(error)}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <select name="classroom" defaultValue={classroomId ?? ""} className={inputCls}>
            <option value="">Toutes les classes</option>
            {classrooms.map((cl) => (
              <option key={cl.id} value={cl.id}>{cl.name}</option>
            ))}
          </select>
          <select name="period" defaultValue={periodId ?? ""} className={inputCls}>
            <option value="">Toutes les périodes</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select name="status" defaultValue={status ?? ""} className={inputCls}>
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50">
            Filtrer
          </button>
          <a
            href={`/app/report-cards/export?format=csv${classroomId ? `&classroom=${classroomId}` : ""}${periodId ? `&period=${periodId}` : ""}${status ? `&status=${status}` : ""}`}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
          >
            Registre CSV
          </a>
          <a
            href={`/app/report-cards/export?format=xlsx${classroomId ? `&classroom=${classroomId}` : ""}${periodId ? `&period=${periodId}` : ""}${status ? `&status=${status}` : ""}`}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
          >
            Registre Excel
          </a>
          {canGenerate && classroomId && periodId ? (
            <button
              type="submit"
              form="generate-class"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Générer tous les bulletins de la classe
            </button>
          ) : null}
          {canPrint && classroomId && periodId ? (
            <a
              href={`/app/report-cards/pdf?classroom=${classroomId}&period=${periodId}${status ? `&status=${status}` : ""}`}
              target="_blank"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
            >
              PDF collectif
            </a>
          ) : null}
        </form>
        {canGenerate && classroomId && periodId ? (
          <form id="generate-class" action={generateClassReportCardsAction}>
            <input type="hidden" name="classroomId" value={classroomId} />
            <input type="hidden" name="academicPeriodId" value={periodId} />
          </form>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th className="py-2 pr-3">Identifiant</th>
              <th className="py-2 pr-3">Élève</th>
              <th className="py-2 pr-3">Classe</th>
              <th className="py-2 pr-3">Période</th>
              <th className="py-2 pr-3">Version</th>
              <th className="py-2 pr-3">Statut</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => (
              <tr key={card.id} className="border-b border-zinc-100">
                <td className="py-2 pr-3 font-mono text-xs">
                  <Link href={`/app/report-cards/${card.id}`} className="hover:underline">
                    {card.identifier}
                  </Link>
                </td>
                <td className="py-2 pr-3 font-medium">
                  {card.student.lastName} {card.student.firstName}
                </td>
                <td className="py-2 pr-3">{card.classroom.name}</td>
                <td className="py-2 pr-3">{card.academicPeriod.name}</td>
                <td className="py-2 pr-3">v{card.currentVersion}</td>
                <td className="py-2 pr-3">{STATUS_LABELS[card.status]}</td>
                <td className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {canPrint ? (
                      <a
                        href={`/app/report-cards/pdf?id=${card.id}`}
                        target="_blank"
                        className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
                      >
                        Aperçu / PDF
                      </a>
                    ) : null}
                    {canValidate && card.status === "PUBLISHED" ? (
                      <form action={rectifyReportCardAction} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={card.id} />
                        <input
                          name="reason"
                          required
                          placeholder="Motif de rectification"
                          className="rounded-lg border border-zinc-300 px-2 py-1 text-xs"
                        />
                        <button type="submit" className="rounded-lg border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50">
                          Rectifier
                        </button>
                      </form>
                    ) : null}
                    <Link
                      href={`/app/students/${card.student.id}`}
                      className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
                    >
                      Fiche élève
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {cards.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-zinc-500">
                  Aucun bulletin. Calculez les moyennes puis générez les bulletins.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
