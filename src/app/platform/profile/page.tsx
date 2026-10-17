import { requirePlatformContext } from "@/lib/tenant/context";
import {
  getPlatformProfile,
  userIsPlatformSales,
} from "@/lib/services/platform/profile";
import { updateWhatsappAction } from "./actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { HelpLink, Notice, NoticeSection } from "@/components/ui/Notice";

export const instant = false;

export default async function PlatformProfilePage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePlatformContext();
  const sp = (await props.searchParams) ?? {};
  const [profile, isSales] = await Promise.all([
    getPlatformProfile(ctx.userId),
    userIsPlatformSales(ctx.userId),
  ]);
  if (!profile) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Profil</div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          {profile.firstName} {profile.lastName}
        </h1>
        <p className="mt-1 text-sm text-zinc-600">{profile.email}</p>
        <div className="mt-3">
          <HelpLink>Notifications commerciales</HelpLink>
        </div>
        {sp.error ? (
          <p className="mt-2 text-sm text-red-600">
            {typeof sp.error === "string" ? errorMessage(sp.error) : null}
          </p>
        ) : null}
        {sp.ok ? (
          <p className="mt-2 text-sm text-emerald-600">Enregistré.</p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-zinc-900">
          Alertes WhatsApp commerciales
        </h2>
        {isSales ? (
          <>
            <p className="mt-2 text-sm text-zinc-600">
              Recevez une alerte WhatsApp lorsqu&apos;un établissement soumet une
              demande d&apos;inscription. Format international attendu (ex.
              +226XXXXXXXX).
            </p>
            <form action={updateWhatsappAction} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="whatsappNumber"
                  className="block text-sm font-medium text-zinc-700"
                >
                  Numéro WhatsApp
                </label>
                <input
                  id="whatsappNumber"
                  name="whatsappNumber"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+226XXXXXXXX"
                  defaultValue={profile.whatsappNumber ?? ""}
                  className="mt-1 w-full max-w-xs rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex items-start gap-2">
                <input
                  id="whatsappOptIn"
                  name="whatsappOptIn"
                  type="checkbox"
                  defaultChecked={profile.whatsappOptIn}
                  className="mt-1"
                />
                <label htmlFor="whatsappOptIn" className="text-sm text-zinc-700">
                  J&apos;accepte de recevoir des notifications WhatsApp
                  professionnelles (nouvelles demandes d&apos;inscription).
                  Désactivable à tout moment.
                </label>
              </div>
              <SubmitButton pendingLabel="Enregistrement…">
                Enregistrer
              </SubmitButton>
            </form>
          </>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">
            Réservé aux commerciaux de la plateforme.
          </p>
        )}
      </div>

      <Notice title="Notice — notifications commerciales (demandes d'inscription)">
        <NoticeSection title="Déclencheur">
          Chaque fois qu&apos;un établissement soumet une demande
          d&apos;inscription (page publique « Inscription »), une notification
          est créée pour <strong>tous les commerciaux actifs</strong> de la
          plateforme — il n&apos;y a pas d&apos;attribution exclusive. Le
          message contient le nom de l&apos;établissement, sa ville/son pays et
          l&apos;offre demandée, avec un lien vers la fiche de la demande ; les
          coordonnées du demandeur ne sont pas transmises.
        </NoticeSection>
        <NoticeSection title="Deux canaux">
          <strong>Notification interne</strong> : systématique pour chaque
          commercial actif — visible dans les notifications de la plateforme.
          <strong>WhatsApp</strong> : en plus, une livraison est préparée pour
          chaque commercial ayant renseigné un numéro valide ci-dessus et
          activé le consentement. Le consentement est révocable à tout moment.
        </NoticeSection>
        <NoticeSection title="Traitement asynchrone et traçabilité">
          Les envois passent par la file de jobs (reprise automatique en cas
          d&apos;erreur, sans doublon : une seule livraison par couple
          demande/commercial). Chaque livraison est tracée avec son statut
          (en file, envoyée, bloquée par opt-out, échouée) — consultable dans
          Supervision.
        </NoticeSection>
        <NoticeSection title="Simulation et activation future">
          Le canal WhatsApp fonctionne via l&apos;API officielle Meta Business
          Platform. Tant que le mode simulation est actif, aucune requête
          n&apos;est envoyée à Meta : les livraisons sont marquées DRYRUN.
          L&apos;activation réelle nécessitera un numéro WhatsApp Business
          vérifié, un template de message approuvé et la configuration des
          identifiants techniques par l&apos;équipe plateforme.
        </NoticeSection>
      </Notice>
    </div>
  );
}
