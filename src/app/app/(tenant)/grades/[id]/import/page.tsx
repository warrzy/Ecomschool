import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { GradeImportWizard } from "./wizard";
import { statusLabel } from "@/lib/ui/statusLabels";
import { HelpLink, Notice, NoticeSection } from "@/components/ui/Notice";

export default async function GradesImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const tenant = await requireSchoolPermission("grades.enter");
  const { id } = await params;

  const assessment = await prisma.assessment.findFirst({
    where: { id, schoolId: tenant.schoolId },
    select: {
      id: true,
      title: true,
      maxScore: true,
      status: true,
      date: true,
      academicPeriod: { select: { isLocked: true, name: true } },
    },
  });
  if (!assessment) redirect("/app/grades" as never);

  const locked =
    !!assessment.academicPeriod?.isLocked ||
    ["VALIDATED", "PUBLISHED", "CANCELLED"].includes(assessment.status);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <Link
          href={`/app/grades/${assessment.id}`}
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← {assessment.title}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-900">
          Import de notes — {assessment.title}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Barème 0 à {assessment.maxScore}
          {assessment.academicPeriod?.name
            ? ` — période ${assessment.academicPeriod.name}`
            : ""}
        </p>
        <div className="mt-3">
          <HelpLink>Imports et exports</HelpLink>
        </div>
      </div>

      <Notice title="Notice — importer des notes">
        <NoticeSection title="Principe">
          Le fichier contient une ligne par élève (identifiant + note au barème
          de l&apos;évaluation, ici 0 à {assessment.maxScore}). Les lignes sont
          analysées puis présentées en <strong>aperçu</strong> : aucune note
          n&apos;est enregistrée sans confirmation.
        </NoticeSection>
        <NoticeSection title="Formats et limites">
          Fichiers <strong>CSV</strong> ou <strong>XLSX</strong>, 2 Mo maximum
          et jusqu&apos;à 200 notes par import. Le modèle téléchargeable donne
          les colonnes attendues ; les lignes invalides ou hors barème sont
          signalées avant validation. L&apos;aperçu expire après 15 minutes.
        </NoticeSection>
        <NoticeSection title="Exports">
          Les listes de notes, résultats et bulletins s&apos;exportent en{" "}
          <strong>CSV/XLSX</strong> depuis les écrans correspondants ; les
          bulletins publiés sont aussi disponibles en <strong>PDF</strong>.
          Les exports complets exigent les permissions de gestion associées.
        </NoticeSection>
      </Notice>

      {locked ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Cette évaluation est verrouillée (période clôturée ou statut
          {` ${statusLabel("assessment", assessment.status)}`}) — l’import
          est impossible.
        </p>
      ) : (
        <GradeImportWizard
          assessmentId={assessment.id}
          maxScore={assessment.maxScore}
        />
      )}
    </div>
  );
}
