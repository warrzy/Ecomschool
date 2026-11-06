import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  listSessions,
  listRules,
  SCOPE_LABELS,
  SESSION_STATUS_LABELS,
  SESSION_STATUS_TONES,
  PROGRESSION_LABELS,
} from "@/lib/services/deliberations";
import {
  createSessionAction,
  createRuleAction,
  archiveRuleAction,
} from "@/app/app/(tenant)/deliberations/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { ReenrollmentProgression } from "@prisma/client";

export const instant = false;

const PROGRESSION_OPTIONS: ReenrollmentProgression[] = [
  "PROMOTION",
  "REPETITION",
  "SAME_LEVEL",
  "CLASS_CHANGE",
  "CYCLE_CHANGE",
  "RETURN",
];

export default async function DeliberationsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("deliberations.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined;
  const ok = str("ok");
  const error = str("error");
  const tab = str("tab") === "regles" ? "regles" : "sessions";

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "deliberations.manage",
  });

  const [sessions, rules, classrooms, periods, years, levels] =
    await Promise.all([
      listSessions(ctx),
      listRules(ctx),
      prisma.classroom.findMany({
        where: { schoolId: tenant.schoolId },
        orderBy: [{ academicYear: { startDate: "desc" } }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          academicYear: { select: { name: true } },
        },
      }),
      prisma.academicPeriod.findMany({
        where: { schoolId: tenant.schoolId },
        orderBy: [{ academicYear: { startDate: "desc" } }, { number: "asc" }],
        select: {
          id: true,
          name: true,
          academicYear: { select: { name: true } },
        },
      }),
      prisma.academicYear.findMany({
        where: { schoolId: tenant.schoolId },
        orderBy: { startDate: "desc" },
        select: { id: true, name: true },
      }),
      prisma.level.findMany({
        where: { schoolId: tenant.schoolId },
        orderBy: { order: "asc" },
        select: { id: true, name: true },
      }),
    ]);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-bold">Délibérations</h1>
      <p className="mt-1 text-sm text-gray-600">
        Conseils de classe : propositions calculées à partir des règles de
        l&rsquo;établissement, examen et ajustement motivé, validation du
        conseil, puis publication contrôlée. Les moyennes et notes
        d&rsquo;origine ne sont jamais modifiées.
      </p>

      {ok && (
        <p className="mt-4 rounded bg-green-50 p-3 text-sm text-green-800">
          {okMessage(ok)}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">
          {errorMessage(error)}
        </p>
      )}

      <nav className="mt-4 flex gap-2 border-b pb-2">
        <Link
          href="/app/deliberations"
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            tab === "sessions"
              ? "bg-brand-600 text-white"
              : "border border-zinc-300 text-zinc-700 hover:bg-mist"
          }`}
        >
          Sessions
        </Link>
        <Link
          href="/app/deliberations?tab=regles"
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            tab === "regles"
              ? "bg-brand-600 text-white"
              : "border border-zinc-300 text-zinc-700 hover:bg-mist"
          }`}
        >
          Règles de décision
        </Link>
      </nav>

      {tab === "sessions" && (
        <>
          {canManage && (
            <section className="mt-6 rounded border border-zinc-200 bg-white p-4">
              <h2 className="font-semibold">Préparer une délibération</h2>
              <p className="mt-1 text-xs text-gray-500">
                Les résultats de la classe doivent être calculés au préalable
                (onglet Moyennes). Une session existe déjà pour chaque couple
                classe × période (ou classe × année pour le conseil annuel).
              </p>
              <form
                action={createSessionAction}
                className="mt-3 flex flex-wrap items-end gap-3"
              >
                <label className="text-sm">
                  Type de conseil
                  <select
                    name="scope"
                    required
                    className="mt-1 block rounded border px-2 py-1"
                  >
                    <option value="PERIOD">Conseil de période</option>
                    <option value="ANNUAL">Délibération annuelle</option>
                  </select>
                </label>
                <label className="text-sm">
                  Classe
                  <select
                    name="classroomId"
                    required
                    className="mt-1 block rounded border px-2 py-1"
                  >
                    <option value="">—</option>
                    {classrooms.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.academicYear.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Période (conseil de période uniquement)
                  <select
                    name="academicPeriodId"
                    className="mt-1 block rounded border px-2 py-1"
                  >
                    <option value="">— aucune —</option>
                    {periods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.academicYear.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-56 flex-1 text-sm">
                  Note (optionnelle)
                  <input
                    name="note"
                    maxLength={1000}
                    placeholder="Objet ou contexte du conseil"
                    className="mt-1 block w-full rounded border px-2 py-1"
                  />
                </label>
                <SubmitButton>Préparer les propositions</SubmitButton>
              </form>
            </section>
          )}

          <section className="mt-6">
            <h2 className="font-semibold">Sessions de délibération</h2>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  <th className="py-2">PV n°</th>
                  <th>Type</th>
                  <th>Classe</th>
                  <th>Période / année</th>
                  <th>Élèves</th>
                  <th>Statut</th>
                  <th>Préparée le</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-gray-500">
                      Aucune délibération. Préparez une session après le calcul
                      des moyennes.
                    </td>
                  </tr>
                )}
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b">
                    <td className="py-2 font-mono text-xs">{s.number}</td>
                    <td>{SCOPE_LABELS[s.scope]}</td>
                    <td>{s.classroom.name}</td>
                    <td>
                      {s.scope === "PERIOD"
                        ? s.academicPeriod?.name
                        : s.academicYear.name}
                    </td>
                    <td>{s._count.decisions}</td>
                    <td>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${SESSION_STATUS_TONES[s.status]}`}
                      >
                        {SESSION_STATUS_LABELS[s.status]}
                      </span>
                    </td>
                    <td>{s.createdAt.toLocaleDateString("fr-FR")}</td>
                    <td className="text-right">
                      <Link
                        href={`/app/deliberations/${s.id}`}
                        className="text-blue-700 underline"
                      >
                        Ouvrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === "regles" && (
        <>
          <section className="mt-6">
            <h2 className="font-semibold">Règles de décision</h2>
            <p className="mt-1 text-xs text-gray-500">
              Évaluées dans l&rsquo;ordre croissant : la première règle dont
              la bande de moyenne contient la moyenne de l&rsquo;élève produit
              la proposition. Une règle « notes complètes requises » est
              ignorée tant que le dossier de l&rsquo;élève est incomplet.
              Les règles propres à une année priment sur les règles
              générales. Aucun seuil n&rsquo;est imposé par la plateforme.
            </p>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  <th className="py-2">Ordre</th>
                  <th>Conseil</th>
                  <th>Libellé</th>
                  <th>Moyenne</th>
                  <th>Dossier complet</th>
                  <th>Progression</th>
                  <th>Périmètre</th>
                  <th>Statut</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-gray-500">
                      Aucune règle — sans règle, aucune proposition n&rsquo;est
                      calculée et le conseil saisit chaque décision.
                    </td>
                  </tr>
                )}
                {rules.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b ${r.status === "ARCHIVED" ? "text-gray-400" : ""}`}
                  >
                    <td className="py-2">{r.order}</td>
                    <td>{SCOPE_LABELS[r.scope]}</td>
                    <td className="font-medium">{r.label}</td>
                    <td>
                      {r.minAverage == null && r.maxAverage == null
                        ? "Toutes"
                        : `[${r.minAverage ?? "−∞"} ; ${r.maxAverage ?? "+∞"}[`}
                    </td>
                    <td>{r.requiresComplete ? "Oui" : "Non"}</td>
                    <td>
                      {r.progression
                        ? PROGRESSION_LABELS[r.progression]
                        : "—"}
                    </td>
                    <td className="text-xs">
                      {r.academicYear?.name ?? "Toutes années"}
                      {r.level ? ` · ${r.level.name}` : ""}
                    </td>
                    <td>
                      {r.status === "ACTIVE" ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                          Active
                        </span>
                      ) : (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
                          Archivée
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      {r.status === "ACTIVE" && canManage && (
                        <form action={archiveRuleAction} className="inline">
                          <input type="hidden" name="id" value={r.id} />
                          <button
                            type="submit"
                            className="text-red-700 underline"
                          >
                            Archiver
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {canManage && (
            <section className="mt-6 rounded border border-zinc-200 bg-white p-4">
              <h2 className="font-semibold">Nouvelle règle</h2>
              <form
                action={createRuleAction}
                className="mt-3 flex flex-wrap items-end gap-3"
              >
                <label className="text-sm">
                  Conseil
                  <select
                    name="scope"
                    required
                    className="mt-1 block rounded border px-2 py-1"
                  >
                    <option value="PERIOD">Conseil de période</option>
                    <option value="ANNUAL">Délibération annuelle</option>
                  </select>
                </label>
                <label className="min-w-48 text-sm">
                  Libellé de la décision
                  <input
                    name="label"
                    required
                    maxLength={100}
                    placeholder="ex. Admis en classe supérieure"
                    className="mt-1 block w-full rounded border px-2 py-1"
                  />
                </label>
                <label className="w-24 text-sm">
                  Moyenne min
                  <input
                    name="minAverage"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    className="mt-1 block w-full rounded border px-2 py-1"
                  />
                </label>
                <label className="w-24 text-sm">
                  Moyenne max
                  <input
                    name="maxAverage"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    className="mt-1 block w-full rounded border px-2 py-1"
                  />
                </label>
                <label className="w-20 text-sm">
                  Ordre
                  <input
                    name="order"
                    type="number"
                    min="0"
                    defaultValue={0}
                    className="mt-1 block w-full rounded border px-2 py-1"
                  />
                </label>
                <label className="text-sm">
                  Progression (réinscription)
                  <select
                    name="progression"
                    className="mt-1 block rounded border px-2 py-1"
                  >
                    <option value="">—</option>
                    {PROGRESSION_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {PROGRESSION_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Année (optionnel)
                  <select
                    name="academicYearId"
                    className="mt-1 block rounded border px-2 py-1"
                  >
                    <option value="">Toutes</option>
                    {years.map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Niveau (optionnel)
                  <select
                    name="levelId"
                    className="mt-1 block rounded border px-2 py-1"
                  >
                    <option value="">Tous</option>
                    {levels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="requiresComplete" />
                  Notes complètes requises
                </label>
                <SubmitButton>Ajouter la règle</SubmitButton>
              </form>
            </section>
          )}
        </>
      )}
    </main>
  );
}
