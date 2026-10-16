import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { StudentImportWizard } from "./wizard";

export default async function StudentsImportPage() {
  const tenant = await requireSchoolPermission("student.manage");

  const years = await prisma.academicYear.findMany({
    where: { schoolId: tenant.schoolId },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, isCurrent: true, status: true },
  });

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <Link
          href="/app/students"
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← Élèves
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-900">
          Import d’élèves
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Assistant sécurisé : modèle, analyse, aperçu, confirmation.
        </p>
      </div>

      {years.length === 0 ? (
        <p className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
          Aucune année scolaire configurée.
        </p>
      ) : (
        <StudentImportWizard
          years={years.map((y) => ({
            value: y.id,
            label: `${y.name}${y.isCurrent ? " (courante)" : ""}${y.status === "CLOSED" ? " — fermée" : ""}`,
          }))}
        />
      )}
    </div>
  );
}
