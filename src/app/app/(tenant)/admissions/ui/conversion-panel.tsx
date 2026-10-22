import Link from "next/link";
import type { previewConversion } from "@/lib/services/admissionConversion";
import {
  convertApplicationAction,
  liftConditionsAction,
} from "@/app/app/(tenant)/admissions/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";

type Preview = NonNullable<Awaited<ReturnType<typeof previewConversion>>>;

const input =
  "mt-1 block h-9 rounded-lg border border-zinc-300 px-2 text-sm";

const BLOCKER_LABELS: Record<string, string> = {
  statut_non_admis: "Le dossier n'est pas admis.",
  conditions_non_levees:
    "Admission conditionnelle : les conditions doivent être levées avant conversion.",
  pieces_manquantes: "Pièces obligatoires manquantes.",
  annee_cloturee: "L'année scolaire cible est clôturée.",
  doublons_a_arbitrer:
    "Élèves existants potentiellement identiques — arbitrage requis.",
  responsable_a_arbitrer:
    "Responsables existants partageant le contact déclaré — arbitrage requis.",
  classe_complete: "La classe présélectionnée est complète.",
};

const fmtAmount = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

/**
 * Parcours de conversion G2-D : prérequis, doublons, choix élève /
 * responsable / classe, prévisualisation des créances, confirmation.
 * Réservé aux porteurs de `admissions.convert`.
 */
export function ConversionPanel(props: {
  applicationId: string;
  preview: Preview;
  canDecide: boolean;
}) {
  const { preview: p } = props;
  const app = p.application;

  if (app.status === "CONVERTED") return null;

  const selectedClassroom = p.classrooms.find((c) => c.selected) ?? null;

  return (
    <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
      <div className="text-xs font-semibold uppercase text-zinc-500">
        Conversion en inscription définitive
      </div>

      {/* Blocages */}
      {p.blockers.length ? (
        <ul
          aria-label="Blocages à la conversion"
          className="mt-2 space-y-1"
        >
          {p.blockers.map((b) => (
            <li
              key={b}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900"
            >
              {BLOCKER_LABELS[b] ?? b}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-emerald-800">
          Aucun blocage détecté — la conversion peut être confirmée.
        </p>
      )}

      {/* Levée de conditions */}
      {app.status === "CONDITIONALLY_ACCEPTED" ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-white p-3 text-sm">
          <div className="font-medium">Admission sous conditions</div>
          <p className="mt-1 text-xs text-zinc-600">
            Conditions : {app.decisionConditions ?? "—"}
          </p>
          {app.conditionsLiftedAt ? (
            <p className="mt-1 text-xs font-medium text-emerald-700">
              Conditions levées le{" "}
              {app.conditionsLiftedAt.toISOString().slice(0, 10)}.
            </p>
          ) : props.canDecide ? (
            <form
              action={liftConditionsAction}
              className="mt-2 flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="id" value={props.applicationId} />
              <label className="text-xs font-medium text-zinc-700">
                Justification (facultative)
                <input
                  aria-label="Justification de la levée de conditions"
                  name="note"
                  className={`${input} w-64`}
                />
              </label>
              <SubmitButton className="h-9 rounded-lg border border-emerald-400 bg-emerald-50 px-3 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
                Lever les conditions
              </SubmitButton>
            </form>
          ) : (
            <p className="mt-1 text-xs text-amber-800">
              La levée exige la permission « admissions.decide ».
            </p>
          )}
        </div>
      ) : null}

      {/* Frais de candidature : indicatif, jamais déduit automatiquement */}
      {p.campaign.applicationFee != null ? (
        <p className="mt-2 text-xs text-zinc-500">
          Frais de candidature déclarés :{" "}
          {fmtAmount(p.campaign.applicationFee)} — encaissés au guichet,
          non déduits automatiquement des créances générées.
        </p>
      ) : null}

      {p.missingDocs.length ? (
        <p className="mt-2 text-xs text-red-700">
          Pièces obligatoires absentes : {p.missingDocs.join(", ")}
        </p>
      ) : null}

      {/* Prévisualisation des créances pour la classe sélectionnée */}
      <div className="mt-3 text-sm">
        <div className="text-xs font-semibold uppercase text-zinc-500">
          Créances prévues{" "}
          {selectedClassroom ? `(classe ${selectedClassroom.name})` : ""}
        </div>
        {p.chargesPreview.length ? (
          <ul className="mt-1 space-y-0.5 text-xs text-zinc-700">
            {p.chargesPreview.map((c, i) => (
              <li key={i}>
                {c.category} — {fmtAmount(c.amount)}
                {c.installments > 1 ? ` en ${c.installments} échéances` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-zinc-500">
            Aucun tarif obligatoire applicable — l&apos;inscription reste
            possible, les créances seront à configurer.
          </p>
        )}
        {p.classrooms.length > 1 ? (
          <p className="mt-1 text-xs text-zinc-500">
            Estimation autre classe :{" "}
            {p.classrooms
              .filter((c) => !c.selected)
              .map((c) => (
                <Link
                  key={c.id}
                  href={`/app/admissions?id=${props.applicationId}&cls=${c.id}`}
                  className="mr-2 text-brand-700 underline"
                >
                  {c.name}
                </Link>
              ))}
          </p>
        ) : null}
      </div>

      {/* Formulaire de conversion */}
      {p.eligible ? (
        <form
          action={convertApplicationAction}
          className="mt-3 space-y-3 rounded-lg border border-zinc-200 bg-white p-3"
        >
          <input type="hidden" name="id" value={props.applicationId} />

          <label className="block text-xs font-medium text-zinc-700">
            Classe cible (année {p.campaign.academicYear.name})
            <select
              aria-label="Classe cible"
              name="classroomId"
              required
              defaultValue={selectedClassroom?.id ?? ""}
              className={input}
            >
              {p.classrooms.map((c) => (
                <option
                  key={c.id}
                  value={c.id}
                  disabled={c.seatsLeft != null && c.seatsLeft <= 0}
                >
                  {c.name} ({c.levelName})
                  {c.matchesTarget ? " — niveau demandé" : ""} —{" "}
                  {c.seatsLeft == null
                    ? `${c.enrolled} inscrit(s), capacité libre`
                    : `${c.seatsLeft} place(s) libre(s) / ${c.capacity}`}
                </option>
              ))}
            </select>
          </label>

          {/* Élève : nouveau ou existant */}
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-zinc-700">
              Élève
            </legend>
            {p.duplicates.length ? (
              <>
                <label className="block text-xs font-medium text-zinc-700">
                  Rattacher à un élève existant
                  <select
                    aria-label="Élève existant"
                    name="studentId"
                    defaultValue=""
                    className={input}
                  >
                    <option value="">— Créer un nouvel élève —</option>
                    {p.duplicates.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.matricule} — {d.lastName} {d.firstName}
                        {d.birthDate
                          ? ` (${d.birthDate.toISOString().slice(0, 10)})`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-zinc-700">
                  <input type="checkbox" name="acknowledgeDuplicates" />
                  Confirmer la création d&apos;une nouvelle fiche malgré les
                  correspondances
                </label>
              </>
            ) : (
              <input type="hidden" name="studentId" value="" />
            )}
            <label className="block text-xs font-medium text-zinc-700">
              Matricule (nouvel élève)
              <input
                aria-label="Matricule du nouvel élève"
                name="matricule"
                placeholder="Requis si nouvel élève"
                className={input}
              />
            </label>
          </fieldset>

          {/* Responsable : rattachement ou création */}
          {!p.application.selfApplicant ? (
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium text-zinc-700">
                Responsable légal
              </legend>
              {p.guardianInfo ? (
                <p className="text-xs text-zinc-600">
                  Déclaré : {p.guardianInfo.firstName}{" "}
                  {p.guardianInfo.lastName}
                  {p.guardianInfo.relation
                    ? ` (${p.guardianInfo.relation})`
                    : ""}{" "}
                  — {p.guardianInfo.phone}
                </p>
              ) : null}
              {p.guardianCandidates.length ? (
                <label className="block text-xs font-medium text-zinc-700">
                  Rapprochement
                  <select
                    aria-label="Responsable à rattacher"
                    name="guardianChoice"
                    defaultValue=""
                    className={input}
                  >
                    <option value="">— Choisir —</option>
                    {p.guardianCandidates.map((g) => (
                      <option key={g.id} value={`reuse:${g.id}`}>
                        Rattacher : {g.lastName} {g.firstName} — {g.phone}
                        {g.studentCount
                          ? ` (${g.studentCount} enfant(s))`
                          : ""}
                      </option>
                    ))}
                    <option value="create">
                      Créer un nouveau responsable
                    </option>
                  </select>
                </label>
              ) : (
                <p className="text-xs text-zinc-500">
                  Aucun responsable correspondant : un nouveau responsable
                  sera créé.
                </p>
              )}
            </fieldset>
          ) : null}

          <label className="flex items-center gap-2 text-xs font-medium text-zinc-700">
            <input type="checkbox" name="confirm" required />
            Je confirme la conversion — création irréversible de
            l&apos;élève, du responsable, de l&apos;inscription et des
            créances.
          </label>

          <SubmitButton className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Convertir en inscription
          </SubmitButton>
        </form>
      ) : (
        <p className="mt-3 text-xs text-zinc-500">
          Levée des conditions requise avant de pouvoir convertir ce
          dossier.
        </p>
      )}
    </div>
  );
}
