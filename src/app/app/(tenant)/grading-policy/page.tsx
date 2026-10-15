import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import {
  listPolicies,
  activationPreview,
  archivePreview,
  describePolicy,
} from "@/lib/services/grading/policy";
import { DEFAULT_RULES } from "@/lib/services/grading/calculation";
import {
  upsertPolicyAction,
  activatePolicyAction,
  archivePolicyAction,
} from "@/app/app/(tenant)/grading-policy/actions";

export const instant = false;

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT:
    "Données invalides : vérifiez les valeurs numériques (barème, seuil, décimales) et le format des champs.",
  INVALID_MENTIONS:
    "Format des mentions invalide. Attendu : Libellé:seuil;Libellé:seuil — ex. Excellent:16;Très bien:14;Bien:12.",
  MENTION_RANGE:
    "Mentions : un seuil doit rester dans l'échelle du barème (entre la note minimale et la note maximale).",
  INVALID_WEIGHTS:
    "Pondération annuelle invalide : un nom de période ne correspond à aucune période de l'année choisie, ou un coefficient n'est pas un nombre positif.",
  MIN_GE_MAX:
    "Barème incohérent : la note minimale doit être strictement inférieure à la note maximale.",
  SEUIL_RANGE:
    "Seuil de réussite incohérent : il doit être compris entre la note minimale et la note maximale (barème).",
  NOT_FOUND: "Année scolaire ou niveau introuvable dans cet établissement.",
  INVALID_STATE:
    "Action impossible pour cette politique : son statut ne le permet pas (ou elle est déjà active/archivée).",
  CONFLICT:
    "Une politique active existe déjà pour cette année et ce niveau.",
  ALREADY_EXISTS:
    "Un brouillon ou une politique existe déjà pour cette année et ce niveau.",
  SCOPE_LOCKED:
    "La portée (année/niveau) d'une politique active ne peut pas être déplacée. Créez plutôt un brouillon pour le nouveau périmètre puis activez-le.",
  UPDATE_FAILED: "L'enregistrement a échoué. Réessayez ; si le problème persiste, contactez le support.",
};

function Field(props: {
  label: string;
  name: string;
  hint: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  const hintId = `${props.name}-hint`;
  return (
    <div className="space-y-1">
      <label
        htmlFor={props.name}
        className="flex items-center gap-1.5 text-sm font-medium text-zinc-800"
      >
        {props.label}
        {props.tooltip ? (
          <span
            title={props.tooltip}
            aria-label={props.tooltip}
            className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-zinc-300 text-[10px] font-semibold text-zinc-500"
          >
            ?
          </span>
        ) : null}
      </label>
      {props.children}
      <p id={hintId} className="text-xs text-zinc-500">
        {props.hint}
      </p>
    </div>
  );
}

function Section(props: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-zinc-100 pt-4 first:border-t-0 first:pt-0">
      <legend className="float-left w-full text-sm font-semibold text-zinc-900">
        {props.title}
      </legend>
      {props.description ? (
        <p className="mb-3 mt-1 text-xs text-zinc-500">{props.description}</p>
      ) : (
        <div className="mb-3" />
      )}
      <div className="clear-both grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {props.children}
      </div>
    </fieldset>
  );
}

export default async function GradingPolicyPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("gradingpolicy.manage");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const editId = typeof sp.edit === "string" ? sp.edit : undefined;
  const confirmKind = typeof sp.confirm === "string" ? sp.confirm : undefined;
  const confirmId = typeof sp.id === "string" ? sp.id : undefined;

  const [policies, years, levels, periods] = await Promise.all([
    listPolicies(c),
    prisma.academicYear.findMany({
      where: { schoolId: tenant.schoolId },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true, isCurrent: true },
    }),
    prisma.level.findMany({
      where: { schoolId: tenant.schoolId, status: "ACTIVE" },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
    prisma.academicPeriod.findMany({
      where: { schoolId: tenant.schoolId },
      orderBy: { number: "asc" },
      select: { id: true, name: true, academicYear: { select: { name: true } } },
    }),
  ]);

  const periodNameById = new Map(periods.map((p) => [p.id, p.name] as const));
  const editing = editId ? policies.find((p) => p.id === editId) : undefined;

  // Panneaux de confirmation (activation/remplacement et archivage).
  const confirmActivate =
    confirmKind === "activate" && confirmId
      ? await activationPreview(c, confirmId)
      : undefined;
  const confirmArchive =
    confirmKind === "archive" && confirmId
      ? await archivePreview(c, confirmId)
      : undefined;

  const periodsByYear = new Map<string, string[]>();
  for (const p of periods) {
    const list = periodsByYear.get(p.academicYear.name) ?? [];
    list.push(p.name);
    periodsByYear.set(p.academicYear.name, list);
  }
  const periodsHelp = [...periodsByYear.entries()]
    .map(([y, names]) => `${y} : ${names.join(", ")}`)
    .join(" · ");

  const inputCls =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400";
  const described = (name: string) => ({ "aria-describedby": `${name}-hint` });
  const policyLabel = (v: string) => (v === "ZERO" ? "Zéro" : "Exclue");
  const defaultMentions = DEFAULT_RULES.mentions
    .map((m) => `${m.label}:${m.min}`)
    .join(";");

  // Valeurs préremplies : politique en cours d'édition ou défauts du moteur.
  const v = editing
    ? {
        academicYearId: editing.academicYearId,
        levelId: editing.levelId ?? "",
        maxScore: editing.maxScore,
        minScore: editing.minScore,
        precision: editing.precision,
        rounding: editing.rounding,
        passMark: editing.passMark,
        missingGradePolicy: editing.missingGradePolicy,
        absentPolicy: editing.absentPolicy,
        exemptPolicy: editing.exemptPolicy,
        tieRule: editing.tieRule,
        perSubjectRank: editing.perSubjectRank,
        mentions: Array.isArray(editing.mentions)
          ? (editing.mentions as { label: string; min: number }[])
              .map((m) => `${m.label}:${m.min}`)
              .join(";")
          : "",
        annualWeights:
          editing.annualWeights && typeof editing.annualWeights === "object"
            ? Object.entries(editing.annualWeights as Record<string, number>)
                .map(([pid, coef]) => `${periodNameById.get(pid) ?? pid}:${coef}`)
                .join(";")
            : "",
      }
    : {
        academicYearId: "",
        levelId: "",
        maxScore: 20,
        minScore: 0,
        precision: 2,
        rounding: "HALF_UP" as const,
        passMark: 10,
        missingGradePolicy: "EXCLUDE" as const,
        absentPolicy: "EXCLUDE" as const,
        exemptPolicy: "EXCLUDE" as const,
        tieRule: "SHARED_RANK" as const,
        perSubjectRank: true,
        mentions: "",
        annualWeights: "",
      };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm text-zinc-500">Configuration</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              Règles de notation
            </div>
            <p className="mt-1 max-w-2xl text-sm text-zinc-500">
              Une politique par année scolaire, éventuellement spécifique à un
              niveau. Toute modification crée une nouvelle version — les bulletins
              publiés conservent leur snapshot et ne sont jamais altérés
              rétroactivement.
            </p>
          </div>
          <a
            href="#notice"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Comment fonctionnent les règles de notation ?
          </a>
        </div>
        {ok === "saved" || ok === "activated" || ok === "archived" || ok === "draft" ? (
          <div
            role="status"
            className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            {ok === "saved"
              ? "Règles enregistrées — la version a été incrémentée pour ce couple année/niveau."
              : ok === "activated"
                ? "Politique activée — elle s'applique désormais aux calculs. L'éventuelle politique précédente a été archivée."
                : ok === "archived"
                  ? "Politique archivée — elle n'est plus appliquée mais reste consultable dans l'historique."
                  : "Brouillon enregistré — il n'est pas appliqué aux calculs tant qu'il n'est pas activé."}
          </div>
        ) : null}
        {ok === "unchanged" ? (
          <div
            role="status"
            className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800"
          >
            Aucune modification détectée — la politique et sa version sont
            inchangées.
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {ERROR_MESSAGES[error] ??
              "Une erreur est survenue. Vérifiez le formulaire et réessayez."}
          </div>
        ) : null}
      </div>

      <details
        id="notice"
        className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
          Notice — comment fonctionnent les règles de notation
        </summary>
        <div className="mt-4 space-y-4 text-sm text-zinc-700">
          <div>
            <div className="font-medium text-zinc-900">Portée et priorité</div>
            <p className="mt-1">
              Pour chaque classe, le système cherche d&apos;abord une politique
              du <strong>niveau</strong> de la classe pour l&apos;année
              scolaire, puis la politique <strong>par défaut de l&apos;année</strong>{" "}
              (celle sans niveau), puis les <strong>règles par défaut</strong>{" "}
              (barème /20, seuil 10, 2 décimales, mentions standard).
            </p>
          </div>
          <div>
            <div className="font-medium text-zinc-900">Barème et coefficients</div>
            <p className="mt-1">
              Chaque évaluation garde son propre barème (ex. /40). Les notes sont
              <strong> normalisées</strong> vers le barème de la politique :
              note × barème politique ÷ barème évaluation. La moyenne de matière
              est la moyenne pondérée par les <strong>coefficients
              d&apos;évaluation</strong> ; la moyenne générale est pondérée par
              les <strong>coefficients de matière</strong> (définis par classe,
              sinon par niveau, sinon 1). La « note minimale » est la valeur
              comptée lorsqu&apos;une règle « zéro » s&apos;applique.
            </p>
          </div>
          <div>
            <div className="font-medium text-zinc-900">Arrondi et décimales</div>
            <p className="mt-1">
              Les moyennes sont arrondies au nombre de décimales choisi, selon la
              règle : demi-supérieur (13,445 → 13,45), inférieur ou supérieur.
              Cela s&apos;applique aux moyennes calculées et aux statistiques de
              classe.
            </p>
          </div>
          <div>
            <div className="font-medium text-zinc-900">
              Notes manquantes, absences et dispenses
            </div>
            <p className="mt-1">
              Pour chaque cas (note non saisie, élève absent, élève dispensé) :
              <strong> exclue</strong> = l&apos;évaluation ne compte ni en note ni
              en coefficient, la moyenne se calcule sur les notes présentes et
              le résultat est marqué <em>partiel</em> tant que des notes
              manquent ; <strong>zéro</strong> = la note minimale est comptée
              dans la moyenne avec le coefficient de l&apos;évaluation.
            </p>
          </div>
          <div>
            <div className="font-medium text-zinc-900">Seuil de réussite</div>
            <p className="mt-1">
              Utilisé pour le <strong>taux de réussite</strong> de la classe
              (proportion des moyennes générales ≥ seuil) dans les résultats et
              statistiques.
            </p>
          </div>
          <div>
            <div className="font-medium text-zinc-900">Classement et ex æquo</div>
            <p className="mt-1">
              <strong>Rang partagé</strong> : les ex æquo obtiennent le même rang
              et les rangs suivants sautent (12, 12, 10 → 1er, 1er, 3e).
              <strong> Rang dense</strong> : aucun rang n&apos;est sauté (1er,
              1er, 2e). Le rang par matière ajoute un classement distinct dans
              chaque matière.
            </p>
          </div>
          <div>
            <div className="font-medium text-zinc-900">Mentions</div>
            <p className="mt-1">
              Chaque mention définit un <strong>seuil minimum</strong> sur la
              moyenne générale ; l&apos;élève obtient la plus haute mention dont
              le seuil est atteint. Format de saisie :
              <code className="mx-1 rounded bg-zinc-100 px-1">
                Libellé:seuil;Libellé:seuil
              </code>
              — ex. <code className="rounded bg-zinc-100 px-1">{defaultMentions}</code>.
              Laisser le champ vide conserve les mentions existantes ou applique
              les mentions par défaut.
            </p>
          </div>
          <div>
            <div className="font-medium text-zinc-900">Pondération annuelle</div>
            <p className="mt-1">
              La moyenne annuelle est la moyenne pondérée des moyennes de
              périodes (poids 1 par défaut pour toutes). Pour donner plus de
              poids à une période :{" "}
              <code className="rounded bg-zinc-100 px-1">
                Nom de période:coefficient;…
              </code>{" "}
              — les noms doivent correspondre exactement aux périodes de
              l&apos;année choisie. Périodes configurées :{" "}
              {periodsHelp || "aucune période définie"}. Si une période est
              ensuite supprimée, son coefficient est simplement ignoré (poids 1
              appliqué aux autres) ; si elle est renommée, le poids reste
              attaché à la période.
            </p>
          </div>
          <div>
            <div className="font-medium text-zinc-900">Versions et historique</div>
            <p className="mt-1">
              Enregistrer pour un même couple année + niveau met à jour la
              politique et incrémente son numéro de version. Enregistrer sans
              modifier aucun paramètre ne crée aucune nouvelle version. Les
              bulletins publiés conservent un
              <strong> snapshot figé</strong> des règles en vigueur à leur
              publication : aucun changement de politique ne les modifie
              rétroactivement.
            </p>
          </div>
          <div>
            <div className="font-medium text-zinc-900">
              Brouillons, activation et archivage
            </div>
            <p className="mt-1">
              Trois états : <strong>brouillon</strong> (enregistré, jamais
              appliqué aux calculs tant qu&apos;il n&apos;est pas activé),
              <strong> active</strong> (une seule par année + niveau),
              <strong> archivée</strong> (historique consultable, non
              appliquée). Activer un brouillon ou réactiver une archivée
              remplace la politique active du même périmètre — qui est alors
              archivée, après une confirmation qui la nomme explicitement.
              Archiver une politique demande une confirmation indiquant la
              règle qui prendra le relais et le nombre de bulletins non publiés
              de l&apos;année concernée.
            </p>
          </div>
        </div>
      </details>

      {confirmActivate && !("error" in confirmActivate) ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
          <div className="text-sm font-semibold text-amber-900">
            Confirmer l&apos;activation
          </div>
          <p className="mt-2 text-sm text-amber-900">
            Activer {describePolicy(confirmActivate.target)}
            {confirmActivate.replaced ? (
              <>
                {" "}
                <strong>
                  archivera la politique actuellement active{" "}
                  {describePolicy(confirmActivate.replaced)}
                </strong>{" "}
                — les prochains calculs utiliseront les nouveaux paramètres.
              </>
            ) : (
              " appliquera immédiatement ces règles aux calculs."
            )}{" "}
            Les bulletins déjà publiés ne sont jamais modifiés.
          </p>
          <div className="mt-4 flex gap-3">
            <form action={activatePolicyAction}>
              <input type="hidden" name="policyId" value={confirmId} />
              <input type="hidden" name="confirmed" value="1" />
              <button
                type="submit"
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Confirmer l&apos;activation
              </button>
            </form>
            <a
              href="/app/grading-policy"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Annuler
            </a>
          </div>
        </div>
      ) : null}

      {confirmArchive && !("error" in confirmArchive) ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
          <div className="text-sm font-semibold text-amber-900">
            Confirmer l&apos;archivage
          </div>
          <p className="mt-2 text-sm text-amber-900">
            Archiver {describePolicy(confirmArchive.target)} :
          </p>
          <ul className="mt-2 list-inside list-disc text-sm text-amber-900">
            <li>
              Règle qui prendra le relais : {confirmArchive.fallback}
            </li>
            {confirmArchive.changesScale ? (
              <li className="font-semibold">
                ⚠ Attention : le barème ou le seuil changera pour les prochains
                calculs.
              </li>
            ) : null}
            <li>
              {confirmArchive.unpublishedCount > 0
                ? `${confirmArchive.unpublishedCount} bulletin(s) de cette année ne sont pas encore publiés — leurs prochains recalculs utiliseront la règle de relais.`
                : "Aucun bulletin non publié sur cette année."}
            </li>
            <li>Les bulletins déjà publiés conservent leur snapshot.</li>
            <li>La politique restera consultable et pourra être réactivée.</li>
          </ul>
          <div className="mt-4 flex gap-3">
            <form action={archivePolicyAction}>
              <input type="hidden" name="policyId" value={confirmId} />
              <button
                type="submit"
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Confirmer l&apos;archivage
              </button>
            </form>
            <a
              href="/app/grading-policy"
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Annuler
            </a>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-zinc-900">
            {editing
              ? editing.status === "DRAFT"
                ? "Modifier le brouillon"
                : "Modifier la politique"
              : "Nouvelle politique"}
          </div>
          {editing ? (
            <a
              href="/app/grading-policy"
              className="text-xs text-zinc-500 underline hover:text-zinc-700"
            >
              Annuler la modification
            </a>
          ) : null}
        </div>
        {editing ? (
          <div
            className={`mb-4 rounded-xl border px-3 py-2 text-sm ${
              editing.status === "DRAFT"
                ? "border-sky-200 bg-sky-50 text-sky-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            {editing.status === "DRAFT" ? (
              <>
                Brouillon « {editing.academicYear.name} /{" "}
                {editing.level?.name ?? "tous niveaux"} » — non appliqué aux
                calculs tant qu&apos;il n&apos;est pas activé.
              </>
            ) : (
              <>
                Politique « {editing.academicYear.name} /{" "}
                {editing.level?.name ?? "tous niveaux"} » chargée (v
                {editing.version}) — l&apos;enregistrement créera la v
                {editing.version + 1} si au moins un paramètre change. Les
                bulletins déjà publiés ne sont jamais affectés.
              </>
            )}
          </div>
        ) : null}
        <form action={upsertPolicyAction} className="space-y-5">
          <Section
            title="Portée"
            description="À quelle année scolaire et (optionnellement) à quel niveau ces règles s'appliquent."
          >
            <Field
              label="Année scolaire"
              name="academicYearId"
              hint="Obligatoire. Les règles s'appliquent à toutes les classes de cette année, sauf si une politique de niveau existe."
            >
              <select
                id="academicYearId"
                name="academicYearId"
                required
                defaultValue={v.academicYearId}
                className={inputCls}
                {...described("academicYearId")}
              >
                <option value="">Choisir une année…</option>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                    {y.isCurrent ? " (courante)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Niveau"
              name="levelId"
              hint="Laisser vide pour la politique par défaut de l'année. Une politique de niveau prime sur le défaut."
            >
              <select
                id="levelId"
                name="levelId"
                defaultValue={v.levelId}
                className={inputCls}
                {...described("levelId")}
              >
                <option value="">Tous niveaux (défaut)</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          </Section>

          <Section
            title="Barème, seuil et arrondi"
            description="Échelle de sortie des moyennes et règle d'arrondi."
          >
            <Field
              label="Barème (note max)"
              name="maxScore"
              hint="Échelle finale des moyennes (classiquement 20). Les notes sont normalisées vers ce barème."
              tooltip="Ex. barème 20 : une note de 14/40 devient 7/20."
            >
              <input
                id="maxScore"
                name="maxScore"
                type="number"
                step="0.5"
                min="0.5"
                max="1000"
                defaultValue={v.maxScore}
                className={inputCls}
                {...described("maxScore")}
              />
            </Field>
            <Field
              label="Note minimale"
              name="minScore"
              hint="Valeur comptée quand une règle « zéro » s'applique (généralement 0)."
            >
              <input
                id="minScore"
                name="minScore"
                type="number"
                step="0.5"
                min="0"
                defaultValue={v.minScore}
                className={inputCls}
                {...described("minScore")}
              />
            </Field>
            <Field
              label="Décimales"
              name="precision"
              hint="Nombre de décimales des moyennes (0 à 4 ; 2 = 14,50)."
            >
              <input
                id="precision"
                name="precision"
                type="number"
                min="0"
                max="4"
                defaultValue={v.precision}
                className={inputCls}
                {...described("precision")}
              />
            </Field>
            <Field
              label="Règle d'arrondi"
              name="rounding"
              hint="Demi-supérieur : ,5 monte. Inférieur/supérieur : toujours vers le bas/haut."
              tooltip="Ex. 13,445 avec 2 décimales → 13,45 (demi-sup.), 13,44 (inf.), 13,45 (sup.)."
            >
              <select
                id="rounding"
                name="rounding"
                defaultValue={v.rounding}
                className={inputCls}
                {...described("rounding")}
              >
                <option value="HALF_UP">Demi-supérieur (usuel)</option>
                <option value="FLOOR">Inférieur</option>
                <option value="CEIL">Supérieur</option>
              </select>
            </Field>
            <Field
              label="Seuil de réussite"
              name="passMark"
              hint="Moyenne minimale pour compter une réussite dans les statistiques de classe. Devrait rester ≤ barème."
            >
              <input
                id="passMark"
                name="passMark"
                type="number"
                step="0.5"
                min="0"
                defaultValue={v.passMark}
                className={inputCls}
                {...described("passMark")}
              />
            </Field>
          </Section>

          <Section
            title="Notes non saisies"
            description="Traitement des cas particuliers : note non saisie, élève absent, élève dispensé."
          >
            <Field
              label="Note manquante"
              name="missingGradePolicy"
              hint="Exclue : ignorée du calcul (moyenne partielle). Zéro : la note minimale compte."
              tooltip="Exclue = la moyenne se fait sur les notes présentes et le résultat est signalé « partiel » tant que des notes manquent."
            >
              <select
                id="missingGradePolicy"
                name="missingGradePolicy"
                defaultValue={v.missingGradePolicy}
                className={inputCls}
                {...described("missingGradePolicy")}
              >
                <option value="EXCLUDE">Exclue du calcul</option>
                <option value="ZERO">Comptée comme zéro</option>
              </select>
            </Field>
            <Field
              label="Absence à une évaluation"
              name="absentPolicy"
              hint="Même logique : exclue de la moyenne ou comptée comme zéro."
            >
              <select
                id="absentPolicy"
                name="absentPolicy"
                defaultValue={v.absentPolicy}
                className={inputCls}
                {...described("absentPolicy")}
              >
                <option value="EXCLUDE">Exclue du calcul</option>
                <option value="ZERO">Comptée comme zéro</option>
              </select>
            </Field>
            <Field
              label="Dispense (ex. sport)"
              name="exemptPolicy"
              hint="Même logique : exclue de la moyenne ou comptée comme zéro."
            >
              <select
                id="exemptPolicy"
                name="exemptPolicy"
                defaultValue={v.exemptPolicy}
                className={inputCls}
                {...described("exemptPolicy")}
              >
                <option value="EXCLUDE">Exclue du calcul</option>
                <option value="ZERO">Comptée comme zéro</option>
              </select>
            </Field>
          </Section>

          <Section
            title="Classement"
            description="Règles d'attribution des rangs."
          >
            <Field
              label="Ex æquo"
              name="tieRule"
              hint="Partagé : rangs suivants sautés (1,1,3). Dense : aucun saut (1,1,2)."
            >
              <select
                id="tieRule"
                name="tieRule"
                defaultValue={v.tieRule}
                className={inputCls}
                {...described("tieRule")}
              >
                <option value="SHARED_RANK">Rang partagé (1er, 1er, 3e)</option>
                <option value="DENSE_RANK">Rang dense (1er, 1er, 2e)</option>
              </select>
            </Field>
            <Field
              label="Rang par matière"
              name="perSubjectRank"
              hint="Ajoute un classement des élèves dans chaque matière, en plus du rang général."
            >
              <label className="flex h-[38px] items-center gap-2 text-sm text-zinc-700">
                <input
                  id="perSubjectRank"
                  type="checkbox"
                  name="perSubjectRank"
                  defaultChecked={v.perSubjectRank}
                  className="h-4 w-4"
                  {...described("perSubjectRank")}
                />
                Calculer aussi un rang par matière
              </label>
            </Field>
          </Section>

          <Section
            title="Mentions et pondération annuelle"
            description="Optionnel — laisser vide conserve la valeur existante ou applique les défauts."
          >
            <Field
              label="Mentions"
              name="mentions"
              hint={`Format Libellé:seuil séparés par « ; ». Défaut : ${defaultMentions}`}
              tooltip="La plus haute mention dont le seuil est atteint par la moyenne générale."
            >
              <input
                id="mentions"
                name="mentions"
                defaultValue={v.mentions}
                placeholder="Excellent:16;Très bien:14;Bien:12;Assez bien:10"
                className={inputCls}
                {...described("mentions")}
              />
            </Field>
            <Field
              label="Pondération annuelle"
              name="annualWeights"
              hint={`Format Nom de période:coefficient séparés par « ; ». Périodes : ${periodsHelp || "aucune"}. Poids 1 par défaut.`}
              tooltip="Ex. « Trimestre 3:2 » double le poids du 3e trimestre dans la moyenne annuelle."
            >
              <input
                id="annualWeights"
                name="annualWeights"
                defaultValue={v.annualWeights}
                placeholder="Trimestre 3:2"
                className={inputCls}
                {...described("annualWeights")}
              />
            </Field>
          </Section>

          {editing ? (
            <input type="hidden" name="policyId" value={editing.id} />
          ) : null}
          <div className="flex flex-wrap gap-3">
            {editing?.status === "DRAFT" ? (
              <>
                <button
                  type="submit"
                  name="intent"
                  value="draft"
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Enregistrer le brouillon
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="activate"
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  Activer la politique
                </button>
              </>
            ) : editing ? (
              <>
                <button
                  type="submit"
                  name="intent"
                  value="activate"
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  {editing.status === "ARCHIVED"
                    ? "Réactiver la politique"
                    : "Enregistrer (nouvelle version)"}
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="draft"
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Copier comme brouillon
                </button>
              </>
            ) : (
              <>
                <button
                  type="submit"
                  name="intent"
                  value="activate"
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  Enregistrer et activer
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="draft"
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Enregistrer comme brouillon
                </button>
              </>
            )}
          </div>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">
          Politiques configurées
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <th className="py-2 pr-3">Année</th>
                <th className="py-2 pr-3">Niveau</th>
                <th className="py-2 pr-3">Barème</th>
                <th className="py-2 pr-3">Seuil</th>
                <th className="py-2 pr-3">Cas particuliers</th>
                <th className="py-2 pr-3">Ex æquo</th>
                <th className="py-2 pr-3">Mentions</th>
                <th className="py-2 pr-3">Version</th>
                <th className="py-2 pr-3">Statut</th>
                <th className="py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => {
                const mentions = Array.isArray(p.mentions)
                  ? (p.mentions as { label: string; min: number }[])
                  : null;
                const weighted =
                  p.annualWeights &&
                  typeof p.annualWeights === "object" &&
                  Object.keys(p.annualWeights as object).length > 0;
                return (
                  <tr key={p.id} className="border-b border-zinc-100 align-top">
                    <td className="py-2 pr-3">{p.academicYear.name}</td>
                    <td className="py-2 pr-3">
                      {p.level?.name ?? (
                        <span className="text-zinc-500">Tous (défaut)</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      /{p.maxScore} · {p.precision} déc. ·{" "}
                      {p.rounding === "HALF_UP"
                        ? "½ sup."
                        : p.rounding === "FLOOR"
                          ? "inf."
                          : "sup."}
                    </td>
                    <td className="py-2 pr-3">{p.passMark}</td>
                    <td className="py-2 pr-3 text-xs leading-5">
                      Manq. {policyLabel(p.missingGradePolicy).toLowerCase()}
                      <br />
                      Abs. {policyLabel(p.absentPolicy).toLowerCase()}
                      <br />
                      Disp. {policyLabel(p.exemptPolicy).toLowerCase()}
                    </td>
                    <td className="py-2 pr-3">
                      {p.tieRule === "DENSE_RANK" ? "Dense" : "Partagé"}
                      {p.perSubjectRank ? (
                        <div className="text-xs text-zinc-500">+ par matière</div>
                      ) : null}
                    </td>
                    <td className="max-w-52 py-2 pr-3 text-xs leading-5">
                      {mentions && mentions.length > 0
                        ? mentions.map((m) => `${m.label} ≥ ${m.min}`).join(", ")
                        : "Défaut"}
                      {weighted ? (
                        <div className="mt-0.5 text-zinc-500">
                          Année pondérée par période
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">v{p.version}</td>
                    <td className="py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.status === "ACTIVE"
                            ? "bg-emerald-100 text-emerald-800"
                            : p.status === "DRAFT"
                              ? "bg-sky-100 text-sky-800"
                              : "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {p.status === "ACTIVE"
                          ? "Active"
                          : p.status === "DRAFT"
                            ? "Brouillon"
                            : "Archivée"}
                      </span>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <a
                          href={`/app/grading-policy?edit=${p.id}`}
                          className="font-medium text-zinc-700 underline-offset-2 hover:underline"
                        >
                          {p.status === "ARCHIVED" ? "Consulter" : "Modifier"}
                        </a>
                        {p.status === "DRAFT" || p.status === "ARCHIVED" ? (
                          <form action={activatePolicyAction}>
                            <input type="hidden" name="policyId" value={p.id} />
                            <button
                              type="submit"
                              className="font-medium text-emerald-700 underline-offset-2 hover:underline"
                            >
                              {p.status === "DRAFT" ? "Activer" : "Réactiver"}
                            </button>
                          </form>
                        ) : null}
                        {p.status !== "ARCHIVED" ? (
                          <a
                            href={`/app/grading-policy?confirm=archive&id=${p.id}`}
                            className="font-medium text-red-700 underline-offset-2 hover:underline"
                          >
                            Archiver
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {policies.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-zinc-500">
                    Aucune politique — les règles par défaut s&apos;appliquent :
                    barème /20, seuil 10, 2 décimales, arrondi demi-supérieur,
                    cas particuliers exclus, ex æquo partagés, mentions standard.
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
