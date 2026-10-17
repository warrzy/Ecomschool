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
import { okMessage } from "@/lib/ui/okLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";

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
  const confirm = str("confirm");
  const confirmId = str("id");
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
    "rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200";

  const selClassroom = classrooms.find((cl) => cl.id === classroomId);
  const selPeriod = periods.find((p) => p.id === periodId);
  const confirmCard = cards.find((card) => card.id === confirmId);

  return (
    <div className="space-y-4">
      {confirm === "rectify" && confirmCard ? (
        <ConfirmPanel
          title="Confirmer la rectification du bulletin"
          tone="warning"
          action={rectifyReportCardAction}
          fields={{ id: confirmCard.id }}
          inputs={[
            {
              name: "reason",
              label: "Motif de rectification",
              required: true,
              placeholder: "Ex. erreur de saisie de la note de maths",
            },
          ]}
          confirmLabel="Rectifier le bulletin"
          cancelHref="/app/report-cards"
        >
          Rectifier le bulletin <strong>{confirmCard.identifier}</strong> de{" "}
          <strong>
            {confirmCard.student.lastName} {confirmCard.student.firstName}
          </strong>{" "}
          ({confirmCard.classroom.name} — {confirmCard.academicPeriod.name})
          repasse le bulletin à l&apos;état « Rectifié » : le snapshot publié est
          conservé et une nouvelle version sera produite à la prochaine
          validation. Le motif est tracé dans le registre.
        </ConfirmPanel>
      ) : null}
      {canGenerate && confirm === "generate" && selClassroom && selPeriod ? (
        <ConfirmPanel
          title="Confirmer la génération des bulletins"
          action={generateClassReportCardsAction}
          fields={{
            classroomId: selClassroom.id,
            academicPeriodId: selPeriod.id,
          }}
          confirmLabel="Générer les bulletins"
          cancelHref="/app/report-cards"
        >
          Générer les bulletins de toute la classe{" "}
          <strong>{selClassroom.name}</strong> pour{" "}
          <strong>{selPeriod.name}</strong>. Les bulletins existants à jour ne
          sont pas régénérés ; les versions antérieures sont conservées.
        </ConfirmPanel>
      ) : null}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="text-sm text-zinc-500">Bulletins</div>
        <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
          Bulletins scolaires ({cards.length})
        </h1>
        {ok ? (
          <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {ok === "generated" ? `Bulletins générés (${sp.count ?? ""}).` : okMessage(ok)}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error === "INVALID_STATUS" ? "Calculez les moyennes avant de générer les bulletins." : errorMessage(error)}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <select
                  aria-label="Toutes les classes" name="classroom" defaultValue={classroomId ?? ""} className={inputCls}>
            <option value="">Toutes les classes</option>
            {classrooms.map((cl) => (
              <option key={cl.id} value={cl.id}>{cl.name}</option>
            ))}
          </select>
          <select
                  aria-label="Toutes les périodes" name="period" defaultValue={periodId ?? ""} className={inputCls}>
            <option value="">Toutes les périodes</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
                  aria-label="Tous les statuts" name="status" defaultValue={status ?? ""} className={inputCls}>
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-mist">
            Filtrer
          </button>
          <a
            href={`/app/report-cards/export?format=csv${classroomId ? `&classroom=${classroomId}` : ""}${periodId ? `&period=${periodId}` : ""}${status ? `&status=${status}` : ""}`}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-mist"
          >
            Registre CSV
          </a>
          <a
            href={`/app/report-cards/export?format=xlsx${classroomId ? `&classroom=${classroomId}` : ""}${periodId ? `&period=${periodId}` : ""}${status ? `&status=${status}` : ""}`}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-mist"
          >
            Registre Excel
          </a>
          {canGenerate && classroomId && periodId ? (
            <a
              href={`/app/report-cards?classroom=${classroomId}&period=${periodId}&confirm=generate`}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Générer tous les bulletins de la classe
            </a>
          ) : null}
          {canPrint && classroomId && periodId ? (
            <a
              href={`/app/report-cards/pdf?classroom=${classroomId}&period=${periodId}${status ? `&status=${status}` : ""}`}
              target="_blank"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-mist"
            >
              PDF collectif
            </a>
          ) : null}
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="overflow-x-auto">
        <table aria-label="Bulletins scolaires" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th scope="col" className="py-2 pr-3">Identifiant</th>
              <th scope="col" className="py-2 pr-3">Élève</th>
              <th scope="col" className="py-2 pr-3">Classe</th>
              <th scope="col" className="py-2 pr-3">Période</th>
              <th scope="col" className="py-2 pr-3">Version</th>
              <th scope="col" className="py-2 pr-3">Statut</th>
              <th scope="col" className="py-2">Actions</th>
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
                        className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-mist"
                      >
                        Aperçu / PDF
                      </a>
                    ) : null}
                    {canValidate && card.status === "PUBLISHED" ? (
                      <Link
                        href={`/app/report-cards?confirm=rectify&id=${card.id}`}
                        className="rounded-lg border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50"
                      >
                        Rectifier
                      </Link>
                    ) : null}
                    <Link
                      href={`/app/students/${card.student.id}`}
                      className="rounded-lg border border-zinc-300 px-2 py-1 text-xs hover:bg-mist"
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
    </div>
  );
}
