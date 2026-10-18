"use client";

import { ImportWizard, type WizardRow } from "@/components/import/ImportWizard";

interface StudentRow extends WizardRow {
  matricule: string;
  displayName: string;
  changes: { field: string; from: string | null; to: string | null; erase?: boolean }[];
  enrollment: { classroomName: string; action: "create" | "existing" } | null;
}

const ACTION_LABEL: Record<string, string> = {
  create: "Création",
  update: "Modification",
  unchanged: "Inchangée",
  error: "Erreur",
};

export function StudentImportWizard({
  years,
}: {
  years: { value: string; label: string }[];
}) {
  return (
    <ImportWizard<StudentRow>
      previewUrl="/app/students/import/preview"
      commitUrl="/app/students/import/commit"
      templateUrl="/app/students/import/template"
      title="Assistant d'import d'élèves"
      hint="Modèle : matricule;nom;prenom;sexe;date_naissance;lieu_naissance;telephone;email;adresse;classe — cellule vide = valeur conservée, __EFFACER__ = effacement explicite."
      extraField={{
        name: "academicYearId",
        label: "Année scolaire (pour la colonne « classe »)",
        options: years,
      }}
      columns={["Ligne", "Matricule", "Élève", "Action", "Modifications", "Inscription", "Erreurs"]}
      summaryLabels={[
        { key: "created", label: "Créations" },
        { key: "updated", label: "Modifications" },
        { key: "unchanged", label: "Inchangées" },
        { key: "enrollments", label: "Inscriptions" },
        { key: "erased", label: "Champs effacés" },
        { key: "errors", label: "Erreurs" },
      ]}
      renderCells={(r) => (
        <>
          <td className="px-2 py-2 text-zinc-500">{r.line}</td>
          <td className="px-2 py-2 font-mono text-xs">{r.matricule}</td>
          <td className="px-2 py-2">{r.displayName}</td>
          <td className="px-2 py-2">{ACTION_LABEL[r.action] ?? r.action}</td>
          <td className="px-2 py-2 text-xs">
            {r.changes.map((c) => (
              <div key={c.field}>
                {c.field} : {c.from ?? "—"} →{" "}
                {c.erase ? <em className="text-red-600">effacé</em> : (c.to ?? "—")}
              </div>
            ))}
          </td>
          <td className="px-2 py-2 text-xs">
            {r.enrollment
              ? r.enrollment.action === "create"
                ? `→ ${r.enrollment.classroomName}`
                : `déjà inscrit (${r.enrollment.classroomName})`
              : "—"}
          </td>
          <td className="px-2 py-2 text-xs text-red-700">
            {r.errors.map((e, i) => (
              <div key={i}>
                {e.column ? `${e.column} : ` : ""}
                {e.reason}
              </div>
            ))}
          </td>
        </>
      )}
      resultMessage={(r) =>
        `${r.created ?? 0} création(s), ${r.updated ?? 0} modification(s), ${r.enrollments ?? 0} inscription(s), ${r.unchanged ?? 0} inchangée(s), ${r.chargesCreated ?? 0} créance(s) générée(s), ${r.noTariffs ?? 0} sans tarif applicable, ${r.chargesFailed ?? 0} échec(s) de génération, ${Array.isArray(r.errors) ? r.errors.length : 0} erreur(s).`
      }
    />
  );
}
