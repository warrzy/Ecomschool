"use client";

import { ImportWizard, type WizardRow } from "@/components/import/ImportWizard";

interface GradeRow extends WizardRow {
  matricule: string;
  name: string;
  from: { value: number | null; status: string } | null;
  to: { value: number | null; status: string; observation: string | null };
}

const STATUS_LABEL: Record<string, string> = {
  ENTERED: "Saisie",
  MISSING: "Manquant",
  ABSENT: "Absent",
  EXEMPT: "Dispensé",
  CANCELLED: "Annulé",
};

const ACTION_LABEL: Record<string, string> = {
  create: "Nouvelle",
  update: "Modifiée",
  "status-change": "Statut modifié",
  unchanged: "Inchangée",
  error: "Erreur",
};

const fmt = (g: { value: number | null; status: string } | null) =>
  !g
    ? "—"
    : g.status === "ENTERED"
      ? `${g.value}`
      : (STATUS_LABEL[g.status] ?? g.status);

export function GradeImportWizard({
  assessmentId,
  maxScore,
}: {
  assessmentId: string;
  maxScore: number;
}) {
  return (
    <ImportWizard<GradeRow>
      previewUrl={`/app/grades/${assessmentId}/import/preview`}
      commitUrl={`/app/grades/${assessmentId}/import/commit`}
      templateUrl={`/app/grades/${assessmentId}/import/template`}
      title="Assistant d'import de notes"
      hint={`Modèle : matricule;nom;prenom;note;statut;observation — barème 0 à ${maxScore}. Statuts : ENTERED (note requise), MISSING, ABSENT, EXEMPT (note vide). Import atomique : tout ou rien.`}
      columns={["Ligne", "Matricule", "Élève", "Actuel", "Importé", "Action", "Erreurs"]}
      summaryLabels={[
        { key: "created", label: "Nouvelles" },
        { key: "updated", label: "Modifiées" },
        { key: "statusChanged", label: "Statuts modifiés" },
        { key: "unchanged", label: "Inchangées" },
        { key: "errors", label: "Erreurs" },
      ]}
      blockingErrors
      renderCells={(r) => (
        <>
          <td className="px-2 py-2 text-zinc-400">{r.line}</td>
          <td className="px-2 py-2 font-mono text-xs">{r.matricule}</td>
          <td className="px-2 py-2">{r.name}</td>
          <td className="px-2 py-2 text-xs">{fmt(r.from)}</td>
          <td className="px-2 py-2 text-xs font-medium">
            {fmt(r.to)}
            {r.to.observation ? (
              <span className="text-zinc-400"> — {r.to.observation}</span>
            ) : null}
          </td>
          <td className="px-2 py-2">{ACTION_LABEL[r.action] ?? r.action}</td>
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
        `${r.saved ?? 0} note(s) enregistrée(s), ${r.unchanged ?? 0} ligne(s) inchangée(s).`
      }
    />
  );
}
