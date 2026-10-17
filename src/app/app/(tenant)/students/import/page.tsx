import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { StudentImportWizard } from "./wizard";
import { HelpLink, Notice, NoticeSection } from "@/components/ui/Notice";

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
        <div className="mt-3">
          <HelpLink>Imports et exports</HelpLink>
        </div>
      </div>

      <Notice title="Notice — imports et exports dans ECOM-SCHOOL">
        <NoticeSection title="Modules concernés">
          Deux imports sont disponibles : les <strong>élèves</strong> (cette
          page) et les <strong>notes</strong> (depuis la fiche d&apos;une
          évaluation, onglet import). Toutes les autres données se saisissent
          depuis les écrans de chaque module.
        </NoticeSection>
        <NoticeSection title="Formats et limites">
          Fichiers <strong>CSV</strong> ou <strong>XLSX</strong>, 2 Mo maximum.
          Jusqu&apos;à 2 000 élèves par import et 200 notes par import. Un
          modèle téléchargeable fournit les colonnes attendues ; les lignes
          invalides sont signalées dans l&apos;aperçu avant toute écriture.
        </NoticeSection>
        <NoticeSection title="Aperçu avant validation">
          L&apos;import se fait en deux temps : analyse puis{" "}
          <strong>aperçu détaillé</strong> (lignes valides, erreurs,
          doublons). Rien n&apos;est enregistré sans confirmation explicite ;
          l&apos;aperçu expire au bout de 15 minutes — il faut alors relancer
          l&apos;analyse.
        </NoticeSection>
        <NoticeSection title="Exports">
          Les grandes listes proposent un bouton <strong>Exporter</strong> en{" "}
          <strong>CSV</strong> ou <strong>XLSX</strong> (élèves, enseignants,
          utilisateurs, classes, inscriptions, notes, résultats, bulletins,
          comptes de frais, échéances, encaissements, impayés, emplois du
          temps). Les reçus, bulletins, emplois du temps et factures existent
          aussi en <strong>PDF</strong>. Les exports complets sont réservés aux
          rôles disposant des permissions de gestion correspondantes ; les
          autres exportent un périmètre restreint.
        </NoticeSection>
      </Notice>

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
