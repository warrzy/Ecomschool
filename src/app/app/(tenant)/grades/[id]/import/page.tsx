import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { GradeImportWizard } from "./wizard";
import { statusLabel } from "@/lib/ui/statusLabels";

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
      </div>

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
